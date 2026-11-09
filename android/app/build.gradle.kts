import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Ondertekening: op GitHub uit de geheime instellingen, lokaal uit
// ../../AndroidStudioProjects/notities-release.properties (staat buiten de repo).
val localSigning = Properties().apply {
    val file = rootProject.file("../../AndroidStudioProjects/notities-release.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun signing(name: String): String? = System.getenv(name) ?: localSigning.getProperty(name)

// Elke build op GitHub krijgt een hoger versienummer, zodat Android hem als update ziet.
val buildNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1

android {
    namespace = "nl.timvanbergen.notities"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "nl.timvanbergen.notities"
        minSdk = 26
        targetSdk = 37
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    signingConfigs {
        create("release") {
            signing("NOTITIES_KEYSTORE")?.let { storeFile = file(it) }
            storePassword = signing("NOTITIES_KEYSTORE_PASSWORD")
            keyAlias = signing("NOTITIES_KEY_ALIAS")
            keyPassword = signing("NOTITIES_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

// De website (../public) gaat in de app, zodat hij ook zonder internet opent.
val webBundel by tasks.registering(Sync::class) {
    from(rootProject.file("../public")) { exclude("sw.js", "_headers", ".DS_Store") }
    into(layout.projectDirectory.dir("src/main/assets/www"))
}
tasks.named("preBuild") { dependsOn(webBundel) }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.customview)
}
