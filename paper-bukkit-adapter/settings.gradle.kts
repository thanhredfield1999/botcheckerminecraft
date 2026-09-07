rootProject.name = "botchecker-paper-bukkit-adapter"

// Companion là artifact riêng của operator: nó giữ custody KeyStore và đăng ký
// PaperBukkitOnlinePlayerExternalKeyStoreAccess qua ServicesManager. Nó phụ thuộc
// compile-only vào adapter để dùng CHUNG một service Class (không shade/relocate),
// nên phải là subproject thay vì một file lẻ không ai biên dịch.
include("keystore-companion")
