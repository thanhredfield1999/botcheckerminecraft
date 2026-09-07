import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import vn.heomc.botchecker.paperadapter.CanonicalPaperBukkitOnlinePlayerPayload;

public final class PaperBukkitOnlinePlayerCanonicalFixture {
  private PaperBukkitOnlinePlayerCanonicalFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("expected input and output");
    List<String> values = Files.readAllLines(Path.of(args[0]), StandardCharsets.UTF_8);
    if (values.size() != 21) throw new IllegalArgumentException("unexpected input field count");
    var fields = new CanonicalPaperBukkitOnlinePlayerPayload.Fields(
        values.get(0), values.get(1), Long.parseLong(values.get(2)), values.get(3), values.get(4),
        values.get(5), values.get(6), values.get(7), values.get(8), values.get(9), values.get(10),
        values.get(11), values.get(12), values.get(13), values.get(14), Long.parseLong(values.get(15)),
        Long.parseLong(values.get(16)), Long.parseLong(values.get(17)), values.get(18), values.get(19),
        Integer.parseInt(values.get(20)));
    Files.write(Path.of(args[1]), CanonicalPaperBukkitOnlinePlayerPayload.canonicalUtf8(fields));
  }
}
