plugins {
  java
}

group = "vn.heomc.botchecker"
version = "0.2.0-SNAPSHOT"

repositories {
  mavenCentral()
  maven("https://repo.papermc.io/repository/maven-public/")
}

// Chiến lược hỗ trợ "1.21.11 → bản mới nhất":
//
// Compile against SÀN (1.21.11), không phải bản mới nhất. Lý do cụ thể, không phải thói
// quen: Paper 26.2 yêu cầu JVM runtime 25, nên nếu build theo API mới thì bytecode lên
// 25 và JAR KHÔNG load được trên 1.21.11 (chạy Java 21). Compile theo sàn cho bytecode
// 21 — chạy được trên cả 1.21.11 lẫn 26.x.
//
// Forward-compatibility KHÔNG được giả định: `npm run verify:paper-forward-compat` tải
// paper-api mới nhất từ Maven và biên dịch lại đúng bộ source này. Nếu Paper xoá/đổi một
// API adapter đang dùng, lệnh đó fail — đó mới là bằng chứng, không phải niềm tin.
//
// Kiểm chứng 2026-09-07: 17 file compile sạch với cả 1.21.11-R0.1-SNAPSHOT và
// 26.2.build.121-stable ở --release 21.
val paperApiVersion = providers.gradleProperty("paperApiVersion")
  .getOrElse("1.21.11-R0.1-SNAPSHOT")

dependencies {
  compileOnly("io.papermc.paper:paper-api:$paperApiVersion")
}

java {
  toolchain {
    // Bytecode 21 là mẫu số chung: Paper 1.21.11 chạy Java 21, Paper 26.x chạy Java 25
    // và vẫn load được bytecode 21.
    languageVersion.set(JavaLanguageVersion.of(21))
  }
}

tasks.processResources {
  filesMatching("plugin.yml") {
    expand("version" to project.version)
  }
}
