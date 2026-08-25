# AromaSense Firebase Authentication 配置

AromaSense 的账户身份改由 Firebase Authentication 管理；Cloudflare Worker + D1 继续保存 AromaSense 用户映射、长期同步会话和杯测同步数据。

## 需要由项目所有者完成的外部配置

1. 在 Firebase Console 创建项目，Spark 免费计划即可。
2. 在项目中注册一个 Web App。
3. Security → Authentication → Sign-in method 中启用 **Email/Password**。
4. Authentication → Settings → Authorized domains 中加入 `zjcrop.github.io`。
5. Project settings → General 中记录：
   - Project ID
   - Web API Key
6. GitHub 仓库 `zjcrop/AromaSense` → Settings → Secrets and variables → Actions → Variables：
   - `FIREBASE_PROJECT_ID` = Firebase Project ID
   - `FIREBASE_WEB_API_KEY` = Firebase Web API Key
7. Cloudflare 自动部署仍需要 GitHub Actions Secrets：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

Cloudflare Email Service、`EMAIL` binding 与 `AROMASENSE_EMAIL_FROM` 不再需要。

## 认证边界

- Firebase：邮箱注册、邮箱验证、登录、密码重置邮件。
- AromaSense Worker：校验 Firebase ID Token，并换发 AromaSense 长期同步 Session。
- D1：保存稳定的 AromaSense `user_id`、Firebase UID 映射和同步数据所有权。
- 本地数据库：继续 local-first；未登录或云端不可用不影响本地杯测。

## 发布门槛

部署工作流仅在 Cloudflare 凭据与 Firebase 两个变量均存在时继续。Worker `/health` 必须同时返回：

- `database = configured`
- `authentication = firebase-configured`

随后 Pages 构建必须嵌入同一 Worker URL、Firebase Project ID 与 Web API Key。
