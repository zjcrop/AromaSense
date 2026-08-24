plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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

    kotlinOptions {
        jvmTarget = "17"
    }
}
