package vn.heomc.botchecker.probe;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.ProtectionDomain;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.Semaphore;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipInputStream;

/**
 * Bounded, non-authoritative observation of a class CodeSource file and loader-mediated resource.
 * This class has no signing or private-key API and does not prove loaded bytecode or runtime truth.
 */
public final class JvmArtifactObserver {
    public static final String EVIDENCE_GRADE = "codesource-file-and-class-resource-observed";
    public static final boolean AUTHORITATIVE = false;
    public static final boolean PROVES_LOADED_BYTECODE = false;
    public static final boolean RELEASE_ELIGIBLE = false;
    private static final List<String> ASSUMPTIONS = List.of(
            "standard-non-instrumented-anchor-classloader",
            "java-agent-absence-verified:false"
    );
    private static final Pattern DECLARED_VALUE = Pattern.compile("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}");
    private static final Pattern LOGICAL_PATH = Pattern.compile("[a-zA-Z0-9][a-zA-Z0-9._/+-]{0,199}");
    private static final long MAX_LIMIT = 64L * 1024 * 1024;
    private static final Semaphore OBSERVATION_PERMITS = new Semaphore(2, true);

    private JvmArtifactObserver() {
    }

    public record DeclaredIdentity(String role, String logicalId, String logicalPath) {
        public DeclaredIdentity {
            role = requireDeclared(role, "role", DECLARED_VALUE);
            logicalId = requireDeclared(logicalId, "logicalId", DECLARED_VALUE);
            logicalPath = requireDeclared(logicalPath, "logicalPath", LOGICAL_PATH);
            List<String> pathParts = List.of(logicalPath.split("/", -1));
            if (logicalPath.startsWith("/") || logicalPath.endsWith("/")
                    || pathParts.stream().anyMatch(part -> part.isEmpty() || part.equals(".") || part.equals(".."))) {
                throw new IllegalArgumentException("Invalid declared logicalPath");
            }
        }
    }

    public record Limits(long maxCodeSourceFileBytes, long maxClassResourceBytes) {
        public Limits {
            requireLimit(maxCodeSourceFileBytes, "maxCodeSourceFileBytes");
            requireLimit(maxClassResourceBytes, "maxClassResourceBytes");
            if (maxCodeSourceFileBytes > MAX_LIMIT - maxClassResourceBytes) {
                throw new IllegalArgumentException("Observation total byte budget exceeds bound");
            }
        }
    }

    public enum InternalEntryConsistency {
        MATCH,
        MISMATCH,
        NOT_A_JAR
    }

    public record Observation(
            String grade,
            boolean authoritative,
            boolean provesLoadedBytecode,
            boolean releaseEligible,
            List<String> assumptions,
            DeclaredIdentity declared,
            String observedClassBinaryName,
            String codeSourceUriFingerprint,
            String codeSourceFileSha256,
            long codeSourceFileBytes,
            String classResourceSha256,
            long classResourceBytes,
            String classResourceOrigin,
            boolean classResourceInformational,
            boolean sameLoaderMediated,
            boolean mayDifferFromDefinedBytecode,
            InternalEntryConsistency internalEntryConsistency,
            boolean atomicSnapshot
    ) {
        public Observation {
            assumptions = List.copyOf(assumptions);
        }
    }

    public static Observation observe(Class<?> anchor, DeclaredIdentity declared, Limits limits)
            throws ObservationException {
        return observeInternal(anchor, declared, limits, ignored -> { }, ignored -> { });
    }

    static Observation observeForTesting(
            Class<?> anchor,
            DeclaredIdentity declared,
            Limits limits,
            PathReadHook pathReadHook
    ) throws ObservationException {
        return observeInternal(anchor, declared, limits, pathReadHook, ignored -> { });
    }

    static Observation observeAfterSnapshotForTesting(
            Class<?> anchor,
            DeclaredIdentity declared,
            Limits limits,
            PathReadHook afterSnapshotHook
    ) throws ObservationException {
        return observeInternal(anchor, declared, limits, ignored -> { }, afterSnapshotHook);
    }

    private static Observation observeInternal(
            Class<?> anchor,
            DeclaredIdentity declared,
            Limits limits,
            PathReadHook pathReadHook,
            PathReadHook afterSnapshotHook
    ) throws ObservationException {
        Objects.requireNonNull(anchor, "anchor");
        Objects.requireNonNull(declared, "declared");
        Objects.requireNonNull(limits, "limits");
        Objects.requireNonNull(pathReadHook, "pathReadHook");
        Objects.requireNonNull(afterSnapshotHook, "afterSnapshotHook");
        if (!OBSERVATION_PERMITS.tryAcquire()) {
            throw new ObservationException("OBSERVATION_CONCURRENCY_LIMIT");
        }
        try {
            Path sourcePath = resolveCodeSource(anchor).toRealPath();
            String uriFingerprint = sha256(sourcePath.toUri().toASCIIString()
                    .getBytes(StandardCharsets.UTF_8));
            FileSnapshot file = snapshotFile(
                    sourcePath, limits.maxCodeSourceFileBytes(), pathReadHook);
            afterSnapshotHook.afterMetadata(sourcePath);
            String entryName = anchor.getName().replace('.', '/') + ".class";
            byte[] resourceBytes = readClassResource(anchor, entryName, limits.maxClassResourceBytes());
            InternalEntryConsistency consistency = compareBaseJarEntry(
                    file.bytes(), entryName, resourceBytes, limits.maxClassResourceBytes());
            return new Observation(
                    EVIDENCE_GRADE,
                    AUTHORITATIVE,
                    PROVES_LOADED_BYTECODE,
                    RELEASE_ELIGIBLE,
                    ASSUMPTIONS,
                    declared,
                    anchor.getName(),
                    uriFingerprint,
                    sha256(file.bytes()),
                    file.bytes().length,
                    sha256(resourceBytes),
                    resourceBytes.length,
                    "anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;"
                            + "runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven",
                    true,
                    true,
                    true,
                    consistency,
                    false
            );
        } catch (ObservationException error) {
            throw error;
        } catch (IOException | URISyntaxException | SecurityException error) {
            throw new ObservationException("OBSERVATION_IO_REJECTED");
        } finally {
            OBSERVATION_PERMITS.release();
        }
    }

    private static Path resolveCodeSource(Class<?> anchor)
            throws ObservationException, URISyntaxException, IOException {
        ProtectionDomain protectionDomain = anchor.getProtectionDomain();
        if (protectionDomain == null || protectionDomain.getCodeSource() == null) {
            throw new ObservationException("CODESOURCE_UNAVAILABLE");
        }
        URL location = protectionDomain.getCodeSource().getLocation();
        if (location == null || !"file".equals(location.getProtocol())) {
            throw new ObservationException("CODESOURCE_NOT_LOCAL_FILE");
        }
        URI uri = location.toURI();
        if (uri.getHost() != null && !uri.getHost().isEmpty()) {
            throw new ObservationException("CODESOURCE_NETWORK_PATH_REJECTED");
        }
        Path path = Path.of(uri);
        if (!path.isAbsolute()) throw new ObservationException("CODESOURCE_NOT_ABSOLUTE");
        if (Files.isSymbolicLink(path)) throw new ObservationException("CODESOURCE_SYMLINK_REJECTED");
        BasicFileAttributes attributes = Files.readAttributes(
                path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!attributes.isRegularFile()) throw new ObservationException("CODESOURCE_NOT_REGULAR_FILE");
        return path;
    }

    private static FileSnapshot snapshotFile(
            Path path,
            long maximumBytes,
            PathReadHook pathReadHook
    ) throws IOException, ObservationException {
        BasicFileAttributes before = Files.readAttributes(
                path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!before.isRegularFile() || Files.isSymbolicLink(path)) {
            throw new ObservationException("CODESOURCE_NOT_REGULAR_FILE");
        }
        if (before.size() > maximumBytes) throw new ObservationException("CODESOURCE_FILE_TOO_LARGE");
        pathReadHook.afterMetadata(path);
        byte[] bytes;
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
            bytes = readChannelBounded(channel, maximumBytes);
        }
        BasicFileAttributes after = Files.readAttributes(
                path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!after.isRegularFile() || Files.isSymbolicLink(path)
                || before.size() != after.size()
                || !before.lastModifiedTime().equals(after.lastModifiedTime())
                || (before.fileKey() != null && after.fileKey() != null
                && !before.fileKey().equals(after.fileKey()))) {
            throw new ObservationException("CODESOURCE_CHANGED_WHILE_READING");
        }
        return new FileSnapshot(bytes);
    }

    private static byte[] readChannelBounded(FileChannel channel, long maximumBytes)
            throws IOException, ObservationException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ByteBuffer buffer = ByteBuffer.allocate(16 * 1024);
        long total = 0;
        while (channel.read(buffer) != -1) {
            buffer.flip();
            int count = buffer.remaining();
            total += count;
            if (total > maximumBytes) throw new ObservationException("CODESOURCE_FILE_TOO_LARGE");
            output.write(buffer.array(), buffer.position(), count);
            buffer.clear();
        }
        return output.toByteArray();
    }

    private static byte[] readClassResource(Class<?> anchor, String entryName, long maximumBytes)
            throws IOException, ObservationException {
        try (InputStream input = anchor.getResourceAsStream("/" + entryName)) {
            if (input == null) throw new ObservationException("CLASS_RESOURCE_UNAVAILABLE");
            return readStreamBounded(input, maximumBytes, "CLASS_RESOURCE_TOO_LARGE");
        }
    }

    private static InternalEntryConsistency compareBaseJarEntry(
            byte[] jarSnapshot, String entryName, byte[] resourceBytes, long maximumBytes)
            throws IOException, ObservationException {
        boolean sawEntry = false;
        int entryCount = 0;
        long scannedInflatedBytes = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(jarSnapshot))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                sawEntry = true;
                entryCount++;
                if (entryCount > 4096) throw new ObservationException("JAR_ENTRY_COUNT_LIMIT");
                if (!entryName.equals(entry.getName())) {
                    scannedInflatedBytes = drainEntryBounded(
                            zip, scannedInflatedBytes, maximumBytes, "JAR_SCAN_TOO_LARGE");
                    continue;
                }
                return streamMatchesBounded(zip, resourceBytes, maximumBytes, "JAR_ENTRY_TOO_LARGE")
                        ? InternalEntryConsistency.MATCH
                        : InternalEntryConsistency.MISMATCH;
            }
            return sawEntry ? InternalEntryConsistency.MISMATCH : InternalEntryConsistency.NOT_A_JAR;
        } catch (ZipException error) {
            return InternalEntryConsistency.NOT_A_JAR;
        }
    }

    private static long drainEntryBounded(
            InputStream input,
            long alreadyScanned,
            long maximumBytes,
            String errorCode
    ) throws IOException, ObservationException {
        byte[] buffer = new byte[16 * 1024];
        long total = alreadyScanned;
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (total > maximumBytes - count) throw new ObservationException(errorCode);
            total += count;
        }
        return total;
    }

    private static boolean streamMatchesBounded(
            InputStream input,
            byte[] expected,
            long maximumBytes,
            String errorCode
    ) throws IOException, ObservationException {
        byte[] buffer = new byte[16 * 1024];
        long total = 0;
        boolean matches = true;
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (total > maximumBytes - count) throw new ObservationException(errorCode);
            if (total > expected.length - count) {
                matches = false;
            } else if (matches) {
                for (int index = 0; index < count; index++) {
                    if (buffer[index] != expected[(int) total + index]) {
                        matches = false;
                        break;
                    }
                }
            }
            total += count;
        }
        return matches && total == expected.length;
    }

    private static byte[] readStreamBounded(InputStream input, long maximumBytes, String errorCode)
            throws IOException, ObservationException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        long total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > maximumBytes) throw new ObservationException(errorCode);
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static String sha256(byte[] bytes) throws ObservationException {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException error) {
            throw new ObservationException("SHA256_UNAVAILABLE");
        }
    }

    private static String requireDeclared(String value, String label, Pattern pattern) {
        Objects.requireNonNull(value, label);
        if (!pattern.matcher(value).matches()) throw new IllegalArgumentException("Invalid declared " + label);
        return value;
    }

    private static void requireLimit(long value, String label) {
        if (value <= 0 || value > MAX_LIMIT) throw new IllegalArgumentException("Invalid " + label);
    }

    @FunctionalInterface
    interface PathReadHook {
        void afterMetadata(Path path) throws IOException;
    }

    private record FileSnapshot(byte[] bytes) {
    }

    public static final class ObservationException extends Exception {
        private static final long serialVersionUID = 1L;
        private final String code;

        public ObservationException(String code) {
            super(code);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }
}
