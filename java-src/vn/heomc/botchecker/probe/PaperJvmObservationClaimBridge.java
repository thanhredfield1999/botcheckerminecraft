package vn.heomc.botchecker.probe;

import java.util.Objects;

/**
 * Library-only composition boundary from one Paper JVM observation result to the
 * existing canonical observation-bound claim builder. This class does not issue
 * challenges, sign bytes, load keys, consume nonces, or establish runtime truth.
 */
public final class PaperJvmObservationClaimBridge {
    private PaperJvmObservationClaimBridge() {
    }

    public static JvmObservationBoundClaimBuilder.Input bind(
            JvmObservationBoundClaimBuilder.Claims claims,
            PaperJvmObservationPort.Result result
    ) {
        Objects.requireNonNull(claims, "claims");
        Objects.requireNonNull(result, "result");
        if (claims.observedAtMs() != result.observedAtMs()
                || !claims.claimedServerInstanceId().equals(result.claimedServerInstanceId())
                || !claims.claimedBootId().equals(result.claimedBootId())) {
            throw new IllegalArgumentException("Paper observation metadata does not match claims");
        }
        return new JvmObservationBoundClaimBuilder.Input(claims, result.observation());
    }

    public static byte[] canonicalJsonUtf8V2(
            JvmObservationBoundClaimBuilder.Claims claims,
            PaperJvmObservationPort.Result result
    ) {
        return JvmObservationBoundClaimBuilder.canonicalJsonUtf8V2(bind(claims, result));
    }
}
