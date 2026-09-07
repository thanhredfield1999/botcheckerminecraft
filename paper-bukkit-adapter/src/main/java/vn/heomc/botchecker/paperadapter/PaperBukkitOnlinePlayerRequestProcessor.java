package vn.heomc.botchecker.paperadapter;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Bounded, one-request-at-a-time processor with injected observation and signer boundaries.
 * This class performs no socket, KeyStore, filesystem, environment, or Bukkit access.
 */
public final class PaperBukkitOnlinePlayerRequestProcessor implements AutoCloseable {
  private static final int SIGNATURE_BYTES = 64;
  private static final long MAX_TTL_MS = 60_000L;

  @FunctionalInterface
  public interface TimeSource {
    long nowMs();
  }

  @FunctionalInterface
  public interface SnapshotProvider {
    Snapshot snapshot(PaperBukkitOnlinePlayerTransportCodec.Challenge challenge) throws Exception;
  }

  @FunctionalInterface
  public interface OpaqueSigner {
    byte[] sign(byte[] canonicalPayload) throws Exception;
  }

  public record Snapshot(int onlinePlayers, long observedAtMs) {
    public Snapshot {
      if (onlinePlayers < 0 || onlinePlayers > 10_000 || observedAtMs < 0) {
        throw new IllegalArgumentException("PAPER_BUKKIT_SNAPSHOT_INVALID");
      }
    }
  }

  public record Policy(
      String audience,
      String verifierInstanceId,
      String keyId,
      String bindingId,
      String targetBindingSha256,
      String providerId,
      String providerVersion,
      String providerInstanceId,
      String trustStoreId,
      String trustStoreVersion,
      String trustStoreSha256,
      String claimedServerInstanceId,
      String claimedBootId,
      int maxLedgerEntries) {
    public Policy {
      Objects.requireNonNull(audience, "audience");
      Objects.requireNonNull(verifierInstanceId, "verifierInstanceId");
      Objects.requireNonNull(keyId, "keyId");
      Objects.requireNonNull(bindingId, "bindingId");
      Objects.requireNonNull(targetBindingSha256, "targetBindingSha256");
      Objects.requireNonNull(providerId, "providerId");
      Objects.requireNonNull(providerVersion, "providerVersion");
      Objects.requireNonNull(providerInstanceId, "providerInstanceId");
      Objects.requireNonNull(trustStoreId, "trustStoreId");
      Objects.requireNonNull(trustStoreVersion, "trustStoreVersion");
      Objects.requireNonNull(trustStoreSha256, "trustStoreSha256");
      Objects.requireNonNull(claimedServerInstanceId, "claimedServerInstanceId");
      Objects.requireNonNull(claimedBootId, "claimedBootId");
      if (maxLedgerEntries < 1 || maxLedgerEntries > 1_024) {
        throw new IllegalArgumentException("PAPER_BUKKIT_LEDGER_CAPACITY_INVALID");
      }
    }
  }

  private record LedgerEntry(
      byte[] requestSha256,
      byte[] responseFrame,
      long expiresAtMs,
      long expiresMonotonicMs) {
    private LedgerEntry {
      requestSha256 = Arrays.copyOf(requestSha256, requestSha256.length);
      responseFrame = Arrays.copyOf(responseFrame, responseFrame.length);
    }
  }

  private final Policy policy;
  private final TimeSource wallNow;
  private final TimeSource monotonicNow;
  private final SnapshotProvider snapshotProvider;
  private final OpaqueSigner signer;
  private final Object stateLock = new Object();
  private final Map<String, LedgerEntry> ledger = new LinkedHashMap<>();
  private boolean open = true;
  private boolean processing;
  private boolean monotonicCompromised;
  private Long lastMonotonicMs;

  public PaperBukkitOnlinePlayerRequestProcessor(
      Policy policy,
      TimeSource wallNow,
      TimeSource monotonicNow,
      SnapshotProvider snapshotProvider,
      OpaqueSigner signer) {
    this.policy = Objects.requireNonNull(policy, "policy");
    this.wallNow = Objects.requireNonNull(wallNow, "wallNow");
    this.monotonicNow = Objects.requireNonNull(monotonicNow, "monotonicNow");
    this.snapshotProvider = Objects.requireNonNull(snapshotProvider, "snapshotProvider");
    this.signer = Objects.requireNonNull(signer, "signer");
  }

  public byte[] process(byte[] requestFrame) {
    byte[] ownedRequest = copyRequest(requestFrame);
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(ownedRequest);
    requirePolicy(challenge);
    byte[] requestSha256 = sha256(ownedRequest);
    synchronized (stateLock) {
      requireOpen();
      if (processing) throw new IllegalStateException("PAPER_BUKKIT_PROCESSOR_REENTRANT");
      processing = true;
    }
    try {
      long expiresMonotonicMs;
      synchronized (stateLock) {
        requireOpen();
        long wall = safeWallNow();
        long monotonic = observeMonotonic();
        pruneExpired(wall, monotonic);
        requireFresh(challenge, wall);
        LedgerEntry existing = ledger.get(challenge.challengeId());
        if (existing != null) {
          if (!MessageDigest.isEqual(existing.requestSha256(), requestSha256)) {
            throw new IllegalStateException("PAPER_BUKKIT_CHALLENGE_CONFLICT");
          }
          return Arrays.copyOf(existing.responseFrame(), existing.responseFrame().length);
        }
        if (ledger.size() >= policy.maxLedgerEntries()) {
          throw new IllegalStateException("PAPER_BUKKIT_LEDGER_CAPACITY_EXHAUSTED");
        }
        long remainingMs = challenge.expiresAtMs() - wall;
        if (remainingMs <= 0 || remainingMs > MAX_TTL_MS || monotonic > Long.MAX_VALUE - remainingMs) {
          throw new IllegalStateException("PAPER_BUKKIT_CHALLENGE_DEADLINE_INVALID");
        }
        expiresMonotonicMs = monotonic + remainingMs;
      }

      requireOpenAndFresh(challenge, expiresMonotonicMs);
      Snapshot snapshot;
      try {
        snapshot = Objects.requireNonNull(snapshotProvider.snapshot(challenge), "snapshot");
      } catch (Exception error) {
        throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_FAILED");
      }
      ClockReading afterSnapshot = requireOpenAndFresh(challenge, expiresMonotonicMs);
      if (snapshot.observedAtMs() < challenge.issuedAtMs()
          || snapshot.observedAtMs() > challenge.expiresAtMs()
          || snapshot.observedAtMs() > afterSnapshot.wallMs()) {
        throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_TIME_INVALID");
      }

      var payload = new CanonicalPaperBukkitOnlinePlayerPayload.Fields(
          challenge.audience(), challenge.verifierInstanceId(), challenge.sequence(), challenge.challengeId(),
          challenge.nonceBase64Url(), challenge.runId(), challenge.keyId(), challenge.bindingId(),
          challenge.targetBindingSha256(), challenge.providerId(), challenge.providerVersion(),
          challenge.providerInstanceId(), challenge.trustStoreId(), challenge.trustStoreVersion(),
          challenge.trustStoreSha256(), challenge.issuedAtMs(), challenge.expiresAtMs(),
          snapshot.observedAtMs(), policy.claimedServerInstanceId(), policy.claimedBootId(),
          snapshot.onlinePlayers());
      byte[] canonicalPayload = CanonicalPaperBukkitOnlinePlayerPayload.canonicalUtf8(payload);
      requireOpenAndFresh(challenge, expiresMonotonicMs);
      byte[] signature;
      try {
        signature = copySignature(signer.sign(Arrays.copyOf(canonicalPayload, canonicalPayload.length)));
      } catch (Exception error) {
        throw new IllegalStateException("PAPER_BUKKIT_SIGNING_FAILED");
      }
      requireOpenAndFresh(challenge, expiresMonotonicMs);
      byte[] response = PaperBukkitOnlinePlayerTransportCodec.encodeResponseFrame(canonicalPayload, signature);
      synchronized (stateLock) {
        requireOpen();
        long finalWall = safeWallNow();
        long finalMonotonic = observeMonotonic();
        requireFreshAt(challenge, expiresMonotonicMs, finalWall, finalMonotonic);
        ledger.put(challenge.challengeId(), new LedgerEntry(
            requestSha256, response, challenge.expiresAtMs(), expiresMonotonicMs));
        return Arrays.copyOf(response, response.length);
      }
    } finally {
      synchronized (stateLock) {
        processing = false;
      }
    }
  }

  @Override
  public void close() {
    synchronized (stateLock) {
      open = false;
      ledger.clear();
    }
  }

  private record ClockReading(long wallMs, long monotonicMs) {
  }

  private void requirePolicy(PaperBukkitOnlinePlayerTransportCodec.Challenge challenge) {
    if (!policy.audience().equals(challenge.audience())
        || !policy.verifierInstanceId().equals(challenge.verifierInstanceId())
        || !policy.keyId().equals(challenge.keyId())
        || !policy.bindingId().equals(challenge.bindingId())
        || !policy.targetBindingSha256().equals(challenge.targetBindingSha256())
        || !policy.providerId().equals(challenge.providerId())
        || !policy.providerVersion().equals(challenge.providerVersion())
        || !policy.providerInstanceId().equals(challenge.providerInstanceId())
        || !policy.trustStoreId().equals(challenge.trustStoreId())
        || !policy.trustStoreVersion().equals(challenge.trustStoreVersion())
        || !policy.trustStoreSha256().equals(challenge.trustStoreSha256())) {
      throw new IllegalStateException("PAPER_BUKKIT_CHALLENGE_POLICY_MISMATCH");
    }
  }

  private static void requireFresh(PaperBukkitOnlinePlayerTransportCodec.Challenge challenge, long wall) {
    long ttl = challenge.expiresAtMs() - challenge.issuedAtMs();
    if (ttl <= 0 || ttl > MAX_TTL_MS || wall < challenge.issuedAtMs() || wall >= challenge.expiresAtMs()) {
      throw new IllegalStateException("PAPER_BUKKIT_CHALLENGE_EXPIRED_OR_INVALID");
    }
  }

  private ClockReading requireOpenAndFresh(
      PaperBukkitOnlinePlayerTransportCodec.Challenge challenge,
      long expiresMonotonicMs) {
    synchronized (stateLock) {
      requireOpen();
      long wall = safeWallNow();
      long monotonic = observeMonotonic();
      requireFreshAt(challenge, expiresMonotonicMs, wall, monotonic);
      return new ClockReading(wall, monotonic);
    }
  }

  private static void requireFreshAt(
      PaperBukkitOnlinePlayerTransportCodec.Challenge challenge,
      long expiresMonotonicMs,
      long wall,
      long monotonic) {
    if (wall < challenge.issuedAtMs() || wall >= challenge.expiresAtMs()
        || monotonic >= expiresMonotonicMs) {
      throw new IllegalStateException("PAPER_BUKKIT_CHALLENGE_EXPIRED");
    }
  }

  private long safeWallNow() {
    long value = wallNow.nowMs();
    if (value < 0 || value > 9_007_199_254_740_991L) {
      throw new IllegalStateException("PAPER_BUKKIT_WALL_CLOCK_INVALID");
    }
    return value;
  }

  private long observeMonotonic() {
    long value = monotonicNow.nowMs();
    if (value < 0) throw new IllegalStateException("PAPER_BUKKIT_MONOTONIC_CLOCK_INVALID");
    if (monotonicCompromised) {
      throw new IllegalStateException("PAPER_BUKKIT_MONOTONIC_STATE_COMPROMISED");
    }
    if (lastMonotonicMs != null && value < lastMonotonicMs) {
      monotonicCompromised = true;
      ledger.clear();
      throw new IllegalStateException("PAPER_BUKKIT_MONOTONIC_CLOCK_MOVED_BACKWARDS");
    }
    lastMonotonicMs = value;
    return value;
  }

  private void pruneExpired(long wall, long monotonic) {
    Iterator<Map.Entry<String, LedgerEntry>> iterator = ledger.entrySet().iterator();
    while (iterator.hasNext()) {
      LedgerEntry entry = iterator.next().getValue();
      if (wall >= entry.expiresAtMs() || monotonic >= entry.expiresMonotonicMs()) iterator.remove();
    }
  }

  private void requireOpen() {
    if (!open) throw new IllegalStateException("PAPER_BUKKIT_PROCESSOR_CLOSED");
  }

  private static byte[] copyRequest(byte[] input) {
    if (input == null || input.length == 0 || input.length > 4 * 1024 + 9) {
      throw new IllegalArgumentException("PAPER_BUKKIT_REQUEST_FRAME_INVALID");
    }
    return Arrays.copyOf(input, input.length);
  }

  private static byte[] copySignature(byte[] input) {
    if (input == null || input.length != SIGNATURE_BYTES) {
      throw new IllegalStateException("PAPER_BUKKIT_SIGNATURE_INVALID");
    }
    return Arrays.copyOf(input, input.length);
  }

  private static byte[] sha256(byte[] input) {
    try {
      return MessageDigest.getInstance("SHA-256").digest(input);
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException("SHA256_UNAVAILABLE");
    }
  }
}
