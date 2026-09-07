package vn.heomc.botchecker.paperadapter;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Objects;

/** Strict in-memory v1 transport framing. This class performs no socket or key I/O. */
public final class PaperBukkitOnlinePlayerTransportCodec {
  private static final byte[] REQUEST_MAGIC = new byte[] {'B', 'C', 'P', 'Q'};
  private static final byte[] RESPONSE_MAGIC = new byte[] {'B', 'C', 'P', 'R'};
  private static final int VERSION = 1;
  private static final int REQUEST_HEADER_BYTES = 9;
  private static final int RESPONSE_HEADER_BYTES = 11;
  private static final int MAX_CHALLENGE_BYTES = 4 * 1024;
  private static final int MAX_PAYLOAD_BYTES = 16 * 1024;
  private static final int SIGNATURE_BYTES = 64;
  private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
  private static final String DOMAIN = "botcheckerminecraft.paper-bukkit-online-player.v1";
  private static final String PROFILE = "paper-bukkit-online-player-v1";

  private PaperBukkitOnlinePlayerTransportCodec() {
  }

  public record Challenge(
      String audience,
      String verifierInstanceId,
      long sequence,
      String challengeId,
      String nonceBase64Url,
      String runId,
      String keyId,
      String bindingId,
      String targetBindingSha256,
      String providerId,
      String providerVersion,
      String providerInstanceId,
      String trustStoreId,
      String trustStoreVersion,
      String trustStoreSha256,
      long issuedAtMs,
      long expiresAtMs) {
  }

  public static Challenge decodeRequestFrame(byte[] input) {
    try {
      Objects.requireNonNull(input, "input");
      if (input.length < REQUEST_HEADER_BYTES
          || input.length > REQUEST_HEADER_BYTES + MAX_CHALLENGE_BYTES) throw new IllegalArgumentException();
      ByteBuffer frame = ByteBuffer.wrap(Arrays.copyOf(input, input.length)).order(ByteOrder.BIG_ENDIAN);
      requireMagic(frame, REQUEST_MAGIC);
      if (Byte.toUnsignedInt(frame.get()) != VERSION) throw new IllegalArgumentException();
      int bodyLength = frame.getInt();
      if (bodyLength <= 0 || bodyLength > MAX_CHALLENGE_BYTES || frame.remaining() != bodyLength) {
        throw new IllegalArgumentException();
      }
      Challenge challenge = new Challenge(
          readString(frame), readString(frame), readSafeInteger(frame), readString(frame), readString(frame),
          readString(frame), readString(frame), readString(frame), readString(frame), readString(frame),
          readString(frame), readString(frame), readString(frame), readString(frame), readString(frame),
          readSafeInteger(frame), readSafeInteger(frame));
      if (frame.hasRemaining() || challenge.expiresAtMs() <= challenge.issuedAtMs()) {
        throw new IllegalArgumentException();
      }
      validateChallengeIdentity(challenge);
      if (!Arrays.equals(input, encodeRequestFrame(challenge))) throw new IllegalArgumentException();
      return challenge;
    } catch (RuntimeException error) {
      throw new IllegalArgumentException("PAPER_BUKKIT_REQUEST_FRAME_INVALID");
    }
  }

  public static byte[] encodeResponseFrame(byte[] canonicalPayload, byte[] signature) {
    try {
      Objects.requireNonNull(canonicalPayload, "canonicalPayload");
      Objects.requireNonNull(signature, "signature");
      if (canonicalPayload.length <= 0 || canonicalPayload.length > MAX_PAYLOAD_BYTES
          || signature.length != SIGNATURE_BYTES) throw new IllegalArgumentException();
      ByteBuffer frame = ByteBuffer.allocate(RESPONSE_HEADER_BYTES + canonicalPayload.length + signature.length)
          .order(ByteOrder.BIG_ENDIAN);
      frame.put(RESPONSE_MAGIC).put((byte) VERSION).putInt(canonicalPayload.length)
          .putShort((short) signature.length).put(canonicalPayload).put(signature);
      return frame.array();
    } catch (RuntimeException error) {
      throw new IllegalArgumentException("PAPER_BUKKIT_RESPONSE_FRAME_INVALID");
    }
  }

  private static byte[] encodeRequestFrame(Challenge challenge) {
    try {
      ByteArrayOutputStream bodyBuffer = new ByteArrayOutputStream(1024);
      DataOutputStream body = new DataOutputStream(bodyBuffer);
      writeString(body, challenge.audience());
      writeString(body, challenge.verifierInstanceId());
      writeSafeInteger(body, challenge.sequence());
      writeString(body, challenge.challengeId());
      writeString(body, challenge.nonceBase64Url());
      writeString(body, challenge.runId());
      writeString(body, challenge.keyId());
      writeString(body, challenge.bindingId());
      writeString(body, challenge.targetBindingSha256());
      writeString(body, challenge.providerId());
      writeString(body, challenge.providerVersion());
      writeString(body, challenge.providerInstanceId());
      writeString(body, challenge.trustStoreId());
      writeString(body, challenge.trustStoreVersion());
      writeString(body, challenge.trustStoreSha256());
      writeSafeInteger(body, challenge.issuedAtMs());
      writeSafeInteger(body, challenge.expiresAtMs());
      body.flush();
      byte[] bodyBytes = bodyBuffer.toByteArray();
      if (bodyBytes.length <= 0 || bodyBytes.length > MAX_CHALLENGE_BYTES) throw new IllegalArgumentException();
      ByteBuffer frame = ByteBuffer.allocate(REQUEST_HEADER_BYTES + bodyBytes.length).order(ByteOrder.BIG_ENDIAN);
      frame.put(REQUEST_MAGIC).put((byte) VERSION).putInt(bodyBytes.length).put(bodyBytes);
      return frame.array();
    } catch (IOException error) {
      throw new IllegalStateException("PAPER_BUKKIT_REQUEST_FRAME_ENCODE_FAILED");
    }
  }

  private static String readString(ByteBuffer buffer) {
    if (buffer.remaining() < 2) throw new IllegalArgumentException();
    int length = Short.toUnsignedInt(buffer.getShort());
    if (length <= 0 || length > 512 || buffer.remaining() < length) throw new IllegalArgumentException();
    byte[] bytes = new byte[length];
    buffer.get(bytes);
    try {
      CharBuffer decoded = StandardCharsets.UTF_8.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(bytes));
      return decoded.toString();
    } catch (CharacterCodingException error) {
      throw new IllegalArgumentException();
    }
  }

  private static long readSafeInteger(ByteBuffer buffer) {
    if (buffer.remaining() < Long.BYTES) throw new IllegalArgumentException();
    long value = buffer.getLong();
    if (value < 0 || value > MAX_SAFE_INTEGER) throw new IllegalArgumentException();
    return value;
  }

  private static void writeString(DataOutputStream output, String value) throws IOException {
    Objects.requireNonNull(value, "value");
    byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
    if (bytes.length <= 0 || bytes.length > 512) throw new IllegalArgumentException();
    output.writeShort(bytes.length);
    output.write(bytes);
  }

  private static void writeSafeInteger(DataOutputStream output, long value) throws IOException {
    if (value < 0 || value > MAX_SAFE_INTEGER) throw new IllegalArgumentException();
    output.writeLong(value);
  }

  private static void requireMagic(ByteBuffer frame, byte[] expected) {
    for (byte value : expected) if (!frame.hasRemaining() || frame.get() != value) throw new IllegalArgumentException();
  }

  private static void validateChallengeIdentity(Challenge challenge) {
    String identity = "{\"schemaVersion\":1,\"domain\":" + jsonString(DOMAIN)
        + ",\"profile\":" + jsonString(PROFILE)
        + ",\"audience\":" + jsonString(challenge.audience())
        + ",\"verifierInstanceId\":" + jsonString(challenge.verifierInstanceId())
        + ",\"sequence\":" + challenge.sequence()
        + ",\"nonceBase64Url\":" + jsonString(challenge.nonceBase64Url())
        + ",\"runId\":" + jsonString(challenge.runId())
        + ",\"keyId\":" + jsonString(challenge.keyId())
        + ",\"bindingId\":" + jsonString(challenge.bindingId())
        + ",\"targetBindingSha256\":" + jsonString(challenge.targetBindingSha256())
        + ",\"provider\":{\"kind\":\"server-probe\",\"id\":" + jsonString(challenge.providerId())
        + ",\"version\":" + jsonString(challenge.providerVersion())
        + ("-".equals(challenge.providerInstanceId()) ? "" : ",\"instanceId\":" + jsonString(challenge.providerInstanceId()))
        + "},\"trustStoreId\":" + jsonString(challenge.trustStoreId())
        + ",\"trustStoreVersion\":" + jsonString(challenge.trustStoreVersion())
        + ",\"trustStoreSha256\":" + jsonString(challenge.trustStoreSha256())
        + ",\"issuedAtMs\":" + challenge.issuedAtMs()
        + ",\"expiresAtMs\":" + challenge.expiresAtMs() + "}";
    try {
      String expected = HexFormat.of().formatHex(
          MessageDigest.getInstance("SHA-256").digest(identity.getBytes(StandardCharsets.UTF_8)));
      if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.US_ASCII),
          challenge.challengeId().getBytes(StandardCharsets.US_ASCII))) throw new IllegalArgumentException();
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException("SHA256_UNAVAILABLE");
    }
  }

  private static String jsonString(String value) {
    Objects.requireNonNull(value, "value");
    StringBuilder result = new StringBuilder(value.length() + 2).append('"');
    for (int index = 0; index < value.length(); index++) {
      char character = value.charAt(index);
      switch (character) {
        case '"' -> result.append("\\\"");
        case '\\' -> result.append("\\\\");
        case '\b' -> result.append("\\b");
        case '\f' -> result.append("\\f");
        case '\n' -> result.append("\\n");
        case '\r' -> result.append("\\r");
        case '\t' -> result.append("\\t");
        default -> {
          if (character < 0x20) result.append(String.format("\\u%04x", (int) character));
          else result.append(character);
        }
      }
    }
    return result.append('"').toString();
  }
}
