package vn.heomc.botchecker.probe;

import java.text.Normalizer;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

/**
 * Library-only boundary for a future Paper plugin to capture main-thread context
 * before running bounded artifact I/O away from the Paper primary thread.
 * This class imports no Bukkit/Paper API, performs no signing, and establishes no
 * observer authenticity, trusted time, boot truth, runtime truth, or release eligibility.
 */
public final class PaperJvmObservationPort {
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final Pattern SAFE_ID = Pattern.compile("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}");
    private static final Pattern CREDENTIAL = Pattern.compile(
            "password|passwd|secret|token|credential|api[_-]?key|bearer",
            Pattern.CASE_INSENSITIVE);

    private PaperJvmObservationPort() {
    }

    public static final class Context {
        private final Class<?> anchor;
        private final JvmArtifactObserver.DeclaredIdentity declared;
        private final JvmArtifactObserver.Limits limits;
        private final String claimedServerInstanceId;
        private final String claimedBootId;
        private final AtomicBoolean used = new AtomicBoolean();

        private Context(
                Class<?> anchor,
                JvmArtifactObserver.DeclaredIdentity declared,
                JvmArtifactObserver.Limits limits,
                String claimedServerInstanceId,
                String claimedBootId
        ) {
            this.anchor = anchor;
            this.declared = declared;
            this.limits = limits;
            this.claimedServerInstanceId = claimedServerInstanceId;
            this.claimedBootId = claimedBootId;
        }
    }

    public record Result(
            long observedAtMs,
            String claimedServerInstanceId,
            String claimedBootId,
            JvmArtifactObserver.Observation observation
    ) {
        public Result {
            requireObservedAt(observedAtMs);
            claimedServerInstanceId = requireSafeId(claimedServerInstanceId, "claimed server instance id");
            claimedBootId = requireSafeId(claimedBootId, "claimed boot id");
            Objects.requireNonNull(observation, "observation");
            if (observation.authoritative()
                    || observation.provesLoadedBytecode()
                    || observation.releaseEligible()) {
                throw new IllegalArgumentException("Invalid non-authoritative observation posture");
            }
        }
    }

    public static Context capture(
            BooleanSupplier primaryThreadCheck,
            Class<?> anchor,
            JvmArtifactObserver.DeclaredIdentity declared,
            JvmArtifactObserver.Limits limits,
            String claimedServerInstanceId,
            String claimedBootId
    ) {
        Objects.requireNonNull(primaryThreadCheck, "primaryThreadCheck");
        if (!readThreadCheck(primaryThreadCheck)) {
            throw new IllegalStateException("PAPER_PRIMARY_THREAD_REQUIRED");
        }
        Objects.requireNonNull(anchor, "anchor");
        Objects.requireNonNull(declared, "declared");
        Objects.requireNonNull(limits, "limits");
        String serverInstanceId = requireSafeId(claimedServerInstanceId, "claimed server instance id");
        String bootId = requireSafeId(claimedBootId, "claimed boot id");
        return new Context(anchor, declared, limits, serverInstanceId, bootId);
    }

    public static Result observe(
            Context context,
            BooleanSupplier primaryThreadCheck,
            LongSupplier wallNowMs
    )
            throws JvmArtifactObserver.ObservationException {
        Objects.requireNonNull(context, "context");
        Objects.requireNonNull(primaryThreadCheck, "primaryThreadCheck");
        if (readThreadCheck(primaryThreadCheck)) {
            throw new IllegalStateException("PAPER_PRIMARY_THREAD_IO_REJECTED");
        }
        if (!context.used.compareAndSet(false, true)) {
            throw new IllegalStateException("PAPER_OBSERVATION_CONTEXT_ALREADY_USED");
        }
        Objects.requireNonNull(wallNowMs, "wallNowMs");
        long observedAtMs;
        try {
            observedAtMs = wallNowMs.getAsLong();
        } catch (RuntimeException error) {
            throw new IllegalStateException("PAPER_CLOCK_FAILED");
        }
        requireObservedAt(observedAtMs);
        JvmArtifactObserver.Observation observation = JvmArtifactObserver.observe(
                context.anchor,
                context.declared,
                context.limits);
        return new Result(
                observedAtMs,
                context.claimedServerInstanceId,
                context.claimedBootId,
                observation);
    }

    private static boolean readThreadCheck(BooleanSupplier primaryThreadCheck) {
        try {
            return primaryThreadCheck.getAsBoolean();
        } catch (RuntimeException error) {
            throw new IllegalStateException("PAPER_THREAD_CHECK_FAILED");
        }
    }

    private static String requireSafeId(String value, String label) {
        Objects.requireNonNull(value, label);
        if (!Normalizer.isNormalized(value, Normalizer.Form.NFC)
                || !SAFE_ID.matcher(value).matches()
                || CREDENTIAL.matcher(value).find()) {
            throw new IllegalArgumentException("Invalid " + label);
        }
        return value;
    }

    private static void requireObservedAt(long value) {
        if (value < 0 || value > MAX_SAFE_INTEGER) {
            throw new IllegalArgumentException("Invalid observedAtMs");
        }
    }
}
