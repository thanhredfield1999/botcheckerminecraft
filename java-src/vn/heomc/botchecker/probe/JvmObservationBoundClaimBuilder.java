package vn.heomc.botchecker.probe;

import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Canonical byte builder for the non-authoritative observation-bound claim v2 profile.
 * This class never signs, loads keys, or establishes observation freshness or runtime truth.
 */
public final class JvmObservationBoundClaimBuilder {
    public static final String DOMAIN = "botcheckerminecraft.signed-provider-claim.v1";
    public static final String PROFILE = "jvm-observation-bound-v2";
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final Pattern SAFE_ID = Pattern.compile("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}");
    private static final Pattern SAFE_VERSION = Pattern.compile("[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}");
    private static final Pattern SAFE_PATH_PART = Pattern.compile("[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}");
    private static final Pattern SHA256 = Pattern.compile("[a-f0-9]{64}");
    private static final Pattern BASE64URL = Pattern.compile("[A-Za-z0-9_-]+");
    private static final Pattern CREDENTIAL = Pattern.compile(
            "password|passwd|secret|token|credential|api[_-]?key|bearer",
            Pattern.CASE_INSENSITIVE);
    private static final List<String> ARTIFACT_ROLES = List.of("paper", "candidate", "probe", "config");
    private static final Comparator<Artifact> ARTIFACT_ORDER = Comparator
            .comparing(Artifact::logicalId)
            .thenComparing(Artifact::role)
            .thenComparing(Artifact::logicalPath)
            .thenComparing(Artifact::sha256);

    private JvmObservationBoundClaimBuilder() {
    }

    public record Provider(String kind, String id, String version, String instanceId) {
        public Provider {
            if (!"server-probe".equals(kind)) throw new IllegalArgumentException("Invalid provider kind");
            id = requireSafeId(id, "provider id");
            version = requireSafeVersion(version, "provider version");
            if (instanceId != null) instanceId = requireSafeId(instanceId, "provider instance id");
        }
    }

    public record Artifact(String logicalId, String role, String logicalPath, String sha256) {
        public Artifact {
            logicalId = requireSafeId(logicalId, "artifact logical id");
            role = Objects.requireNonNull(role, "artifact role");
            if (!ARTIFACT_ROLES.contains(role)) throw new IllegalArgumentException("Invalid artifact role");
            logicalPath = requireLogicalPath(logicalPath);
            sha256 = requireSha256(sha256, "artifact sha256");
        }
    }

    public record Claims(
            int schemaVersion,
            String domain,
            String requiredClaimProfile,
            String audience,
            String verifierInstanceId,
            long sequence,
            String challengeId,
            String nonceBase64Url,
            String runId,
            String keyId,
            String bindingId,
            String targetBindingSha256,
            Provider provider,
            String trustStoreId,
            String trustStoreVersion,
            String trustStoreSha256,
            long issuedAtMs,
            long expiresAtMs,
            long observedAtMs,
            String claimedServerInstanceId,
            String claimedBootId,
            List<Artifact> loadedArtifacts
    ) {
        public Claims {
            if (schemaVersion != 1) throw new IllegalArgumentException("Invalid claims schema version");
            if (!DOMAIN.equals(domain)) throw new IllegalArgumentException("Invalid claims domain");
            if (!PROFILE.equals(requiredClaimProfile)) throw new IllegalArgumentException("Invalid claim profile");
            audience = requireSafeId(audience, "audience");
            verifierInstanceId = requireSafeId(verifierInstanceId, "verifier instance id");
            requirePositiveSafeInteger(sequence, "sequence");
            challengeId = requireSha256(challengeId, "challenge id");
            nonceBase64Url = requireCanonicalBase64Url(nonceBase64Url, 32, "nonce");
            runId = requireSafeId(runId, "run id");
            keyId = requireSha256(keyId, "key id");
            bindingId = requireSafeId(bindingId, "binding id");
            targetBindingSha256 = requireSha256(targetBindingSha256, "target binding sha256");
            Objects.requireNonNull(provider, "provider");
            trustStoreId = requireSafeId(trustStoreId, "trust store id");
            trustStoreVersion = requireSafeVersion(trustStoreVersion, "trust store version");
            trustStoreSha256 = requireSha256(trustStoreSha256, "trust store sha256");
            requireNonnegativeSafeInteger(issuedAtMs, "issuedAtMs");
            requirePositiveSafeInteger(expiresAtMs, "expiresAtMs");
            requireNonnegativeSafeInteger(observedAtMs, "observedAtMs");
            if (expiresAtMs <= issuedAtMs
                    || observedAtMs < issuedAtMs
                    || observedAtMs > expiresAtMs) {
                throw new IllegalArgumentException("Invalid claim time window");
            }
            claimedServerInstanceId = requireSafeId(claimedServerInstanceId, "claimed server instance id");
            claimedBootId = requireSafeId(claimedBootId, "claimed boot id");
            Objects.requireNonNull(loadedArtifacts, "loadedArtifacts");
            if (loadedArtifacts.isEmpty() || loadedArtifacts.size() > 128) {
                throw new IllegalArgumentException("Invalid artifact count");
            }
            var snapshot = new ArrayList<Artifact>(loadedArtifacts.size());
            for (Artifact artifact : loadedArtifacts) snapshot.add(Objects.requireNonNull(artifact, "artifact"));
            snapshot.sort(ARTIFACT_ORDER);
            var logicalIds = new HashSet<String>();
            var logicalPaths = new HashSet<String>();
            int candidates = 0;
            int papers = 0;
            int probes = 0;
            int configs = 0;
            for (Artifact artifact : snapshot) {
                if (!logicalIds.add(artifact.logicalId()) || !logicalPaths.add(artifact.logicalPath())) {
                    throw new IllegalArgumentException("Duplicate artifact identity");
                }
                switch (artifact.role()) {
                    case "candidate" -> candidates++;
                    case "paper" -> papers++;
                    case "probe" -> probes++;
                    case "config" -> configs++;
                    default -> throw new IllegalArgumentException("Invalid artifact role");
                }
            }
            if (candidates != 1 || papers != 1 || probes != 1 || configs < 1) {
                throw new IllegalArgumentException("Invalid artifact role cardinality");
            }
            loadedArtifacts = List.copyOf(snapshot);
        }
    }

    public record Input(Claims claims, JvmArtifactObserver.Observation observation) {
        public Input {
            Objects.requireNonNull(claims, "claims");
            Objects.requireNonNull(observation, "observation");
            if (!JvmArtifactObserver.EVIDENCE_GRADE.equals(observation.grade())
                    || observation.authoritative()
                    || observation.provesLoadedBytecode()
                    || observation.releaseEligible()) {
                throw new IllegalArgumentException("Invalid non-authoritative observation posture");
            }
            Artifact candidate = claims.loadedArtifacts().stream()
                    .filter(artifact -> artifact.role().equals("candidate"))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Candidate artifact is unavailable"));
            if (!observation.declared().role().equals("candidate")
                    || !observation.declared().logicalId().equals(candidate.logicalId())
                    || !observation.declared().logicalPath().equals(candidate.logicalPath())
                    || !observation.codeSourceFileSha256().equals(candidate.sha256())) {
                throw new IllegalArgumentException("Observation does not exactly match candidate artifact");
            }
        }
    }

    public static String canonicalJsonV2(Input input) {
        Objects.requireNonNull(input, "input");
        StringBuilder json = new StringBuilder(4096);
        json.append('{')
                .append("\"schemaVersion\":2")
                .append(",\"profile\":").append(jsonString(PROFILE))
                .append(",\"claims\":").append(canonicalClaimsJson(input.claims()))
                .append(",\"jvmArtifactObservation\":")
                .append(JvmArtifactObserver.canonicalJsonV1(input.observation()))
                .append('}');
        return json.toString();
    }

    public static byte[] canonicalJsonUtf8V2(Input input) {
        return canonicalJsonV2(input).getBytes(StandardCharsets.UTF_8);
    }

    private static String canonicalClaimsJson(Claims claims) {
        StringBuilder json = new StringBuilder(3072);
        json.append('{')
                .append("\"schemaVersion\":1")
                .append(",\"domain\":").append(jsonString(DOMAIN))
                .append(",\"requiredClaimProfile\":").append(jsonString(PROFILE))
                .append(",\"audience\":").append(jsonString(claims.audience()))
                .append(",\"verifierInstanceId\":").append(jsonString(claims.verifierInstanceId()))
                .append(",\"sequence\":").append(claims.sequence())
                .append(",\"challengeId\":").append(jsonString(claims.challengeId()))
                .append(",\"nonceBase64Url\":").append(jsonString(claims.nonceBase64Url()))
                .append(",\"runId\":").append(jsonString(claims.runId()))
                .append(",\"keyId\":").append(jsonString(claims.keyId()))
                .append(",\"bindingId\":").append(jsonString(claims.bindingId()))
                .append(",\"targetBindingSha256\":").append(jsonString(claims.targetBindingSha256()))
                .append(",\"provider\":{")
                .append("\"kind\":").append(jsonString(claims.provider().kind()))
                .append(",\"id\":").append(jsonString(claims.provider().id()))
                .append(",\"version\":").append(jsonString(claims.provider().version()));
        if (claims.provider().instanceId() != null) {
            json.append(",\"instanceId\":").append(jsonString(claims.provider().instanceId()));
        }
        json.append('}')
                .append(",\"trustStoreId\":").append(jsonString(claims.trustStoreId()))
                .append(",\"trustStoreVersion\":").append(jsonString(claims.trustStoreVersion()))
                .append(",\"trustStoreSha256\":").append(jsonString(claims.trustStoreSha256()))
                .append(",\"issuedAtMs\":").append(claims.issuedAtMs())
                .append(",\"expiresAtMs\":").append(claims.expiresAtMs())
                .append(",\"observedAtMs\":").append(claims.observedAtMs())
                .append(",\"claimedServerInstanceId\":")
                .append(jsonString(claims.claimedServerInstanceId()))
                .append(",\"claimedBootId\":").append(jsonString(claims.claimedBootId()))
                .append(",\"loadedArtifacts\":[");
        for (int index = 0; index < claims.loadedArtifacts().size(); index++) {
            if (index > 0) json.append(',');
            Artifact artifact = claims.loadedArtifacts().get(index);
            json.append('{')
                    .append("\"logicalId\":").append(jsonString(artifact.logicalId()))
                    .append(",\"role\":").append(jsonString(artifact.role()))
                    .append(",\"logicalPath\":").append(jsonString(artifact.logicalPath()))
                    .append(",\"sha256\":").append(jsonString(artifact.sha256()))
                    .append('}');
        }
        return json.append("]}").toString();
    }

    private static String requireSafeId(String value, String label) {
        return requireText(value, label, SAFE_ID);
    }

    private static String requireSafeVersion(String value, String label) {
        return requireText(value, label, SAFE_VERSION);
    }

    private static String requireText(String value, String label, Pattern pattern) {
        Objects.requireNonNull(value, label);
        if (!Normalizer.isNormalized(value, Normalizer.Form.NFC)
                || !pattern.matcher(value).matches()
                || CREDENTIAL.matcher(value).find()) {
            throw new IllegalArgumentException("Invalid " + label);
        }
        return value;
    }

    private static String requireLogicalPath(String value) {
        Objects.requireNonNull(value, "logical path");
        if (!Normalizer.isNormalized(value, Normalizer.Form.NFC)
                || value.startsWith("/")
                || value.endsWith("/")
                || value.indexOf('\\') >= 0
                || CREDENTIAL.matcher(value).find()) {
            throw new IllegalArgumentException("Invalid logical path");
        }
        String[] parts = value.split("/", -1);
        for (String part : parts) {
            if (part.equals(".") || part.equals("..") || !SAFE_PATH_PART.matcher(part).matches()) {
                throw new IllegalArgumentException("Invalid logical path");
            }
        }
        if (value.length() > 240) throw new IllegalArgumentException("Invalid logical path");
        return value;
    }

    private static String requireSha256(String value, String label) {
        Objects.requireNonNull(value, label);
        if (!SHA256.matcher(value).matches()) throw new IllegalArgumentException("Invalid " + label);
        return value;
    }

    private static String requireCanonicalBase64Url(String value, int bytes, String label) {
        Objects.requireNonNull(value, label);
        if (!BASE64URL.matcher(value).matches()) throw new IllegalArgumentException("Invalid " + label);
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(value);
            if (decoded.length != bytes
                    || !Base64.getUrlEncoder().withoutPadding().encodeToString(decoded).equals(value)) {
                throw new IllegalArgumentException("Invalid " + label);
            }
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("Invalid " + label, error);
        }
        return value;
    }

    private static void requirePositiveSafeInteger(long value, String label) {
        if (value <= 0 || value > MAX_SAFE_INTEGER) throw new IllegalArgumentException("Invalid " + label);
    }

    private static void requireNonnegativeSafeInteger(long value, String label) {
        if (value < 0 || value > MAX_SAFE_INTEGER) throw new IllegalArgumentException("Invalid " + label);
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
