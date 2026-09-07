plugins {
  java
}

group = "vn.heomc.botchecker"
version = rootProject.version

repositories {
  mavenCentral()
  maven("https://repo.papermc.io/repository/maven-public/")
}

// Cùng Paper API version với adapter — companion PHẢI thấy exact service Class mà
// adapter biên dịch, nên hai module không được lệch API version. Xem build.gradle.kts
// gốc để biết vì sao chọn sàn 1.21.11 thay vì bản mới nhất.
val paperApiVersion = providers.gradleProperty("paperApiVersion")
  .getOrElse("1.21.11-R0.1-SNAPSHOT")

dependencies {
  compileOnly("io.papermc.paper:paper-api:$paperApiVersion")
  // Compile-only theo đúng quyết định P0.3: companion phải dùng CHUNG exact service
  // Class do adapter sở hữu. Không shade, không relocate, không đóng gói bản sao
  // interface — nếu làm vậy ServicesManager sẽ thấy hai Class khác nhau và lookup
  // của adapter sẽ không bao giờ khớp.
  compileOnly(project(":"))
}

java {
  toolchain {
    languageVersion.set(JavaLanguageVersion.of(21))
  }
}

tasks.processResources {
  filesMatching("plugin.yml") {
    expand("version" to project.version)
  }
}
