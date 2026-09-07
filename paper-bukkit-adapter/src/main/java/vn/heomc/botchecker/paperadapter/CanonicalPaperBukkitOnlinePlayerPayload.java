package vn.heomc.botchecker.paperadapter;

import java.nio.charset.StandardCharsets;

/** Pure UTF-8 canonical payload builder shared by future adapter transport code. */
public final class CanonicalPaperBukkitOnlinePlayerPayload {
  private CanonicalPaperBukkitOnlinePlayerPayload() {
  }

  public record Fields(
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
      int onlinePlayers) {
  }

  public static byte[] canonicalUtf8(Fields fields) {
    if (fields == null) throw new IllegalArgumentException("fields required");
    return ("{\"schemaVersion\":1,\"domain\":\"botcheckerminecraft.paper-bukkit-online-player.v1\""
        + ",\"profile\":\"paper-bukkit-online-player-v1\""
        + ",\"audience\":" + string(fields.audience)
        + ",\"verifierInstanceId\":" + string(fields.verifierInstanceId)
        + ",\"sequence\":" + fields.sequence
        + ",\"challengeId\":" + string(fields.challengeId)
        + ",\"nonceBase64Url\":" + string(fields.nonceBase64Url)
        + ",\"runId\":" + string(fields.runId)
        + ",\"keyId\":" + string(fields.keyId)
        + ",\"bindingId\":" + string(fields.bindingId)
        + ",\"targetBindingSha256\":" + string(fields.targetBindingSha256)
        + ",\"provider\":{\"kind\":\"server-probe\",\"id\":" + string(fields.providerId)
        + ",\"version\":" + string(fields.providerVersion)
        + ",\"instanceId\":" + string(fields.providerInstanceId) + "}"
        + ",\"trustStoreId\":" + string(fields.trustStoreId)
        + ",\"trustStoreVersion\":" + string(fields.trustStoreVersion)
        + ",\"trustStoreSha256\":" + string(fields.trustStoreSha256)
        + ",\"issuedAtMs\":" + fields.issuedAtMs
        + ",\"expiresAtMs\":" + fields.expiresAtMs
        + ",\"observedAtMs\":" + fields.observedAtMs
        + ",\"claimedServerInstanceId\":" + string(fields.claimedServerInstanceId)
        + ",\"claimedBootId\":" + string(fields.claimedBootId)
        + ",\"onlinePlayers\":" + fields.onlinePlayers
        + ",\"observation\":{\"source\":\"bukkit-getOnlinePlayers-size\",\"primaryThreadSnapshot\":true,\"atomicSnapshot\":false,\"releaseEligible\":false}}")
        .getBytes(StandardCharsets.UTF_8);
  }

  private static String string(String value) {
    if (value == null) throw new IllegalArgumentException("string field required");
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }
}
