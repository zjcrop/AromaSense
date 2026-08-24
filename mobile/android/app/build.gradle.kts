plugins {
    id("com.android.application")
}

android {
    namespace = "com.zjcrop.aromasense"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zjcrop.aromasense"
        minSdk = 26
        targetSdk = 36
        versionCode = 10101
        versionName = "B0.1.a"
    }

    buildTypes {
        release {
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
