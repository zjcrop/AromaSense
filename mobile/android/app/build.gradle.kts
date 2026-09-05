plugins {
    id("com.android.application")
}

val releaseStoreFile = System.getenv("AROMASENSE_KEYSTORE_FILE")
val releaseStorePassword = System.getenv("AROMASENSE_STORE_PASSWORD")
val releaseKeyAlias = System.getenv("AROMASENSE_KEY_ALIAS")
val releaseKeyPassword = System.getenv("AROMASENSE_KEY_PASSWORD")
val hasReleaseSigning = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword
).all { !it.isNullOrBlank() }

android {
    namespace = "com.zjcrop.aromasense"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zjcrop.aromasense"
        minSdk = 26
        targetSdk = 36
        versionCode = 10201
        versionName = "B0.2.a"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("aromaSenseRelease") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("aromaSenseRelease")
            }
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

val repoRoot = rootProject.projectDir.resolve("../..").canonicalFile
val npmExecutable = if (System.getProperty("os.name").lowercase().contains("windows")) "npm.cmd" else "npm"

val bundleWeb by tasks.registering(Exec::class) {
    workingDir = repoRoot
    commandLine(npmExecutable, "run", "bundle:web")
}

tasks.named("preBuild") {
    dependsOn(bundleWeb)
}

dependencies {
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("com.google.mlkit:text-recognition-chinese:16.0.1")
}
