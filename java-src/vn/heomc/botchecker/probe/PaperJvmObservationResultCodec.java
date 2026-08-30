package vn.heomc.botchecker.probe;

import java.nio.charset.StandardCharsets;
import java.util.Objects;

/**
 * Canonical transport-neutral JSON codec for one non-authoritative Paper JVM
 * observation result. It performs no I/O, signing, nonce consumption, or runtime wiring.
 */
public final class PaperJvmObservationResultCodec {
    private static final int MAX_CANONICAL_BYTES = 16 * 1024;

    private PaperJvmObservationResultCodec() {
    }

    public static String canonicalJsonV1(PaperJvmObservationPort.Result result) {
        Objects.requireNonNull(result, "result");
        String json = "{\"schemaVersion\":1"
                + ",\"observedAtMs\":" + result.observedAtMs()
                + ",\"claimedServerInstanceId\":" + jsonString(result.claimedServerInstanceId())
                + ",\"claimedBootId\":" + jsonString(result.claimedBootId())
                + ",\"jvmArtifactObservation\":"
                + JvmArtifactObserver.canonicalJsonV1(result.observation())
                + "}";
        if (json.getBytes(StandardCharsets.UTF_8).length > MAX_CANONICAL_BYTES) {
            throw new IllegalArgumentException("Paper observation result exceeds canonical byte bound");
        }
        return json;
    }

    public static byte[] canonicalJsonUtf8V1(PaperJvmObservationPort.Result result) {
        return canonicalJsonV1(result).getBytes(StandardCharsets.UTF_8);
    }

    private static String jsonString(String value) {
        Objects.requireNonNull(value, "json value");
        StringBuilder json = new StringBuilder(value.length() + 2).append('"');
        for (int index = 0; index < value.length(); index++) {
            char item = value.charAt(index);
            switch (item) {
                case '"' -> json.append("\\\"");
                case '\\' -> json.append("\\\\");
                case '\b' -> json.append("\\b");
                case '\f' -> json.append("\\f");
                case '\n' -> json.append("\\n");
                case '\r' -> json.append("\\r");
                case '\t' -> json.append("\\t");
                default -> {
                    if (item < 0x20
                            || (Character.isHighSurrogate(item)
                            && (index + 1 >= value.length()
                            || !Character.isLowSurrogate(value.charAt(index + 1))))
                            || (Character.isLowSurrogate(item)
                            && (index == 0 || !Character.isHighSurrogate(value.charAt(index - 1))))) {
                        json.append(String.format("\\u%04x", (int) item));
                    } else {
                        json.append(item);
                    }
                }
            }
        }
        return json.append('"').toString();
    }
}
