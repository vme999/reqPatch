# reqPatch

reqPatch 是一个无需本地代理或额外本地程序的 Chrome DevTools MV3 扩展，用于捕获当前 Tab 的 HTTP/HTTPS `fetch` / `XHR` 请求，并临时修改 JSON 请求和响应。

## 功能

- 在独立 DevTools 面板展示 fetch/XHR 请求
- 按 URL 模糊搜索请求
- 查看 Request Payload、Response Body
- JSON 响应以默认展开的树形结构展示
- 一键复制格式化 JSON；支持复制完整请求信息
- 左右面板分隔线可拖拽调整宽度
- 按 URL 前缀和 HTTP Method 创建当前 Tab 规则
- 修改 Query 参数、Request Body JSON 和 Response Body JSON
- 支持 JSON 字段新增、修改、删除及根节点完整替换
- 规则支持启用、停用、删除，并记录命中次数和 JSON Diff

## 安装

1. 执行 `npm test` 和 `npm run check` 验证项目。
2. 打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目目录。
4. 打开目标页面并按 F12，进入 `reqPatch` 面板。
5. 如果面板打开后没有历史请求，刷新目标页面。

## 创建规则

点击左侧“当前 Tab 规则”旁的“新建规则”，填写 URL 前缀和 HTTP Method。

JSON 操作每行一条：

```text
replace $.user.name "Alice"
add $.debug true
remove $.user.stale
```

Query 参数使用 JSON 对象，例如：

```json
{"page": 2, "pageSize": 20}
```

## 技术说明

请求展示使用 [`chrome.devtools.network`](https://developer.chrome.com/docs/extensions/reference/api/devtools/network) 读取 DevTools Network 完成后的 HAR 请求和响应内容；真正的请求/响应拦截使用 [`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger) 的 Fetch 域。

启用规则时 Chrome 会要求 debugger 权限。规则按当前页面的 origin（协议、域名和端口）保存到 `chrome.storage.local`，重新打开该站点的 DevTools 面板后会自动恢复。后台检测到 reqPatch 面板连接断开时，会停用当前站点的所有规则；下次加载时也会再次确保所有规则处于停用状态，需要手动启用。关闭 Tab 或 DevTools 后，debugger 拦截连接需要重新建立。

## 暂不支持

- 原生 Network 面板选中项联动
- 自定义忽略规则
- 默认敏感信息脱敏
- WebSocket、SSE、静态资源修改
- 文件及二进制内容
- 任意 JavaScript 脚本修改
- 云同步、团队协作和本地代理
- 跨 frame 自动 attach

## 开发

```bash
npm run check
npm test
```
