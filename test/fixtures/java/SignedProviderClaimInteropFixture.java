import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import vn.heomc.botchecker.probe.JvmArtifactObserver;

/** Test-only Java 21 interoperability fixture. Never use this private-key loader in production. */
public final class SignedProviderClaimInteropFixture {
    private static final String DOMAIN = "botcheckerminecraft.signed-provider-claim.v1";

    private SignedProviderClaimInteropFixture() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 3 && args.length != 4) {
            throw new IllegalArgumentException("Expected INPUT PKCS8_PRIVATE_KEY OUTPUT [OBSERVATION]");
        }
        var lines = Files.readAllLines(Path.of(args[0]), StandardCharsets.UTF_8);
        var input = Input.parse(lines);
        String observation = args.length == 4
            ? JvmArtifactObserver.canonicalJsonV1(parseObservation(
                Files.readAllLines(Path.of(args[3]), StandardCharsets.UTF_8)))
            : null;
        byte[] canonical = canonicalPayload(input, observation).getBytes(StandardCharsets.UTF_8);
        PrivateKey privateKey = KeyFactory.getInstance("Ed25519").generatePrivate(
            new PKCS8EncodedKeySpec(Files.readAllBytes(Path.of(args[1])))
        );
        Signature signer = Signature.getInstance("Ed25519");
        signer.initSign(privateKey);
        signer.update(canonical);
        byte[] signature = signer.sign();
        if (signature.length != 64) {
            throw new IllegalStateException("Ed25519 signature must be exactly 64 bytes");
        }
        String output = Base64.getUrlEncoder().withoutPadding().encodeToString(canonical)
            + "\n"
            + Base64.getUrlEncoder().withoutPadding().encodeToString(signature)
            + "\n";
        Files.writeString(Path.of(args[2]), output, StandardCharsets.UTF_8);
    }

    private static String canonicalPayload(Input input, String observation) {
        String claims = canonicalClaimsJson(input, observation != null);
        if (observation == null) return claims;
        return "{\"schemaVersion\":2,\"profile\":\"jvm-observation-bound-v2\",\"claims\":"
            + claims + ",\"jvmArtifactObservation\":" + observation + "}";
    }

    private static JvmArtifactObserver.Observation parseObservation(List<String> lines) {
        if (lines.size() != 10) {
            throw new IllegalArgumentException("Observation input must have 10 fields");
        }
        return new JvmArtifactObserver.Observation(
            JvmArtifactObserver.EVIDENCE_GRADE,
            false,
            false,
            false,
            List.of("standard-non-instrumented-anchor-classloader", "java-agent-absence-verified:false"),
            new JvmArtifactObserver.DeclaredIdentity(lines.get(0), lines.get(1), lines.get(2)),
            lines.get(3),
            lines.get(4),
            lines.get(5),
            parseObservationPositiveLong(lines.get(6), "codeSourceFileBytes"),
            lines.get(7),
            parseObservationPositiveLong(lines.get(8), "classResourceBytes"),
            "anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;"
                + "runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven",
            true,
            true,
            true,
            JvmArtifactObserver.InternalEntryConsistency.valueOf(lines.get(9)),
            false
        );
    }

    private static long parseObservationPositiveLong(String value, String label) {
        try {
            long parsed = Long.parseLong(value);
            if (parsed <= 0) throw new IllegalArgumentException(label + " must be positive");
            return parsed;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Invalid " + label, error);
        }
    }

    private static String canonicalClaimsJson(Input input, boolean observationBound) {
        var out = new StringBuilder(2048);
        out.append('{');
        field(out, "schemaVersion", "1", false);
        field(out, "domain", quote(DOMAIN), true);
        if (observationBound) {
            field(out, "requiredClaimProfile", quote("jvm-observation-bound-v2"), true);
        }
        field(out, "audience", quote(input.audience), true);
        field(out, "verifierInstanceId", quote(input.verifierInstanceId), true);
        field(out, "sequence", Long.toString(input.sequence), true);
        field(out, "challengeId", quote(input.challengeId), true);
        field(out, "nonceBase64Url", quote(input.nonceBase64Url), true);
        field(out, "runId", quote(input.runId), true);
        field(out, "keyId", quote(input.keyId), true);
        field(out, "bindingId", quote(input.bindingId), true);
        field(out, "targetBindingSha256", quote(input.targetBindingSha256), true);
        out.append(",\"provider\":{");
        field(out, "kind", quote("server-probe"), false);
        field(out, "id", quote(input.providerId), true);
        field(out, "version", quote(input.providerVersion), true);
        if (input.providerInstanceId != null) {
            field(out, "instanceId", quote(input.providerInstanceId), true);
        }
        out.append('}');
        field(out, "trustStoreId", quote(input.trustStoreId), true);
        field(out, "trustStoreVersion", quote(input.trustStoreVersion), true);
        field(out, "trustStoreSha256", quote(input.trustStoreSha256), true);
        field(out, "issuedAtMs", Long.toString(input.issuedAtMs), true);
        field(out, "expiresAtMs", Long.toString(input.expiresAtMs), true);
        field(out, "observedAtMs", Long.toString(input.observedAtMs), true);
        field(out, "claimedServerInstanceId", quote(input.claimedServerInstanceId), true);
        field(out, "claimedBootId", quote(input.claimedBootId), true);
        out.append(",\"loadedArtifacts\":[");
        for (int i = 0; i < input.artifacts.size(); i++) {
            if (i > 0) out.append(',');
            Artifact artifact = input.artifacts.get(i);
            out.append('{');
            field(out, "logicalId", quote(artifact.logicalId), false);
            field(out, "role", quote(artifact.role), true);
            field(out, "logicalPath", quote(artifact.logicalPath), true);
            field(out, "sha256", quote(artifact.sha256), true);
            out.append('}');
        }
        out.append("]}");
        return out.toString();
    }

    private static void field(StringBuilder out, String name, String value, boolean comma) {
        if (comma) out.append(',');
        out.append(quote(name)).append(':').append(value);
    }

    private static String quote(String value) {
        var out = new StringBuilder(value.length() + 2).append('"');
        for (int index = 0; index < value.length();) {
            int codePoint = value.codePointAt(index);
            index += Character.charCount(codePoint);
            switch (codePoint) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (codePoint < 0x20) {
                        out.append(String.format("\\u%04x", codePoint));
                    } else {
                        out.appendCodePoint(codePoint);
                    }
                }
            }
        }
        return out.append('"').toString();
    }

    private record Artifact(String logicalId, String role, String logicalPath, String sha256) {
    }

    private record Input(
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
        long expiresAtMs,
        long observedAtMs,
        String claimedServerInstanceId,
        String claimedBootId,
        List<Artifact> artifacts
    ) {
        private static Input parse(List<String> lines) {
            if (lines.size() < 21) throw new IllegalArgumentException("Claim input is incomplete");
            int artifactCount = parseNonnegativeInt(lines.get(20), "artifact count");
            if (artifactCount < 1 || artifactCount > 128 || lines.size() != 21 + artifactCount) {
                throw new IllegalArgumentException("Invalid artifact count");
            }
            var artifacts = new ArrayList<Artifact>(artifactCount);
            for (int index = 0; index < artifactCount; index++) {
                String[] fields = lines.get(21 + index).split("\\t", -1);
                if (fields.length != 4) throw new IllegalArgumentException("Invalid artifact row");
                artifacts.add(new Artifact(fields[0], fields[1], fields[2], fields[3]));
            }
            artifacts.sort(Comparator
                .comparing(Artifact::logicalId)
                .thenComparing(Artifact::role)
                .thenComparing(Artifact::logicalPath)
                .thenComparing(Artifact::sha256));
            return new Input(
                lines.get(0), lines.get(1), parsePositiveLong(lines.get(2), "sequence"),
                lines.get(3), lines.get(4), lines.get(5), lines.get(6), lines.get(7), lines.get(8),
                lines.get(9), lines.get(10), "-".equals(lines.get(11)) ? null : lines.get(11),
                lines.get(12), lines.get(13), lines.get(14),
                parseNonnegativeLong(lines.get(15), "issuedAtMs"),
                parsePositiveLong(lines.get(16), "expiresAtMs"),
                parseNonnegativeLong(lines.get(17), "observedAtMs"),
                lines.get(18), lines.get(19), List.copyOf(artifacts)
            );
        }

        private static int parseNonnegativeInt(String value, String label) {
            long parsed = parseNonnegativeLong(value, label);
            if (parsed > Integer.MAX_VALUE) throw new IllegalArgumentException(label + " exceeds int range");
            return (int) parsed;
        }

        private static long parsePositiveLong(String value, String label) {
            long parsed = parseNonnegativeLong(value, label);
            if (parsed == 0) throw new IllegalArgumentException(label + " must be positive");
            return parsed;
        }

        private static long parseNonnegativeLong(String value, String label) {
            try {
                long parsed = Long.parseLong(value);
                if (parsed < 0) throw new IllegalArgumentException(label + " must be nonnegative");
                return parsed;
            } catch (NumberFormatException error) {
                throw new IllegalArgumentException("Invalid " + label, error);
            }
        }
    }
}
