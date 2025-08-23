# CookieCloud Worker D1

这是一个基于 Cloudflare Worker 和 D1 数据库的 CookieCloud 后端实现。

## 一键部署

点击下方按钮，将此项目一键部署到你自己的 Cloudflare 账户中：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/deploy?repo=https://github.com/qaz741wsd856/CookieCloud-Worker-D1)

等待 Worker 部署完毕后，你会得到一个 `https://<...>.workers.dev` 的访问地址，直接把它在 CookieCloud 插件中填为`服务器地址`即可。

## 可选步骤：

### 添加自定义域名

如果你不想用 `*.workers.dev` 域名，想使用自己的域名（例如 `cookie-api.yourdomain.com`）来访问它，

**前提条件：** 你需要拥有一个域名，并已经将其添加到你的 Cloudflare 账户中进行管理。

#### 第 1 步：为你的子域名添加 DNS 记录

你需要为你希望使用的子域名创建一个 DNS 记录，并确保它被 Cloudflare 代理，因此它必须被解析到 Cloudflare CDN 的 IP。

1.  登录到你的 Cloudflare 仪表板。
2.  选择你的域名（例如 `yourdomain.com`）。
3.  进入左侧菜单的 **"DNS"** -> **"记录 (Records)"** 页面。
4.  点击 **"添加记录 (Add record)"**：
    *   **类型 (Type)**: 选择 `AAAA`。这是一个推荐的虚拟记录类型。
    *   **名称 (Name)**: 输入你想要的子域名。例如，如果你想要 `cookie-api.yourdomain.com`，就在这里填 `cookie-api`。
    *   **IPv6 地址 (IPv6 address)**: 输入 `100::`。这是一个标准的虚拟地址，表示“无特定地址”。
    *   **代理状态 (Proxy status)**: **确保云朵是橙色的（Proxied）**。这是最关键的一步，只有被代理的流量才能被 Worker 拦截。
    *   **TTL**: 保持自动即可。
5.  点击 **"保存 (Save)"**。

#### 第 2 步：将路由添加到你的 Worker

现在，你需要告诉 Cloudflare，所有访问你刚刚创建的子域名的流量都应该由这个 Worker 来处理。

1.  在 Cloudflare 仪表板左侧菜单中，进入 **"Workers & Pages"**。
2.  在列表中找到并点击你刚刚通过一键部署创建的 Worker（例如 `cookiecloud-worker`）。
3.  进入该 Worker 的 **"设置 (settings)"** 标签页。
4.  在 **"域和路由 (Domains & Routes)"** 部分，点击 **"添加 (Add)"**。
5.  在弹出的对话框中：
    *   选择`路由 (Route)`
    *   **路由 (Route)**: 输入你的完整域名和通配符。例如：`cookie-api.yourdomain.com/*`。千万不要漏掉最后的 `/*`。
    *   **区域 (Zone)**: 从下拉列表中选择你的主域名（例如 `yourdomain.com`）。
7.  点击 **"添加路由 (Add Route)"**。

完成了！等待几十秒到一分钟，DNS 和路由设置就会在全球生效。现在，你就可以通过你自己的域名 `https://cookie-api.yourdomain.com` 来访问你的 CookieCloud 服务了。

### 自定义 API 访问路径

为了防止你的 Worker 后端被恶意扫描和攻击，你可以设置一个自定义的、不易猜到的访问路径（例如 `my-secret-path-123`）。设置后，所有的 API 请求都必须通过这个路径前缀访问。

**如何配置：**

1.  登录到 Cloudflare 仪表板，进入 **"Workers & Pages"**。
2.  点击你的 `cookiecloud-worker` 服务，进入 **"设置 (Settings)"** -> **"变量 (Variables)"** 页面。
3.  在 **"环境变量 (Environment Variables)"** 部分，点击 **"添加变量 (Add variable)"**。
4.  设置变量：
    *   **变量名称 (Variable Name)**: `API_ROOT`
    *   **值 (Value)**: 输入你想要的自定义路径，例如 `my-secret-path-123` (不需要加斜杠)。
    *   **类型**: 文本或密钥。
5.  点击 **"保存并部署 (Save and deploy)"**。

部署完成后，你在 CookieCloud 插件中填写的访问地址将从 `https://<...>.workers.dev` 变为 `https://<...>.workers.dev/my-secret-path-123`。

> **注意**：如果你不设置此变量，API 将继续在根路径 (`/`) 下工作。