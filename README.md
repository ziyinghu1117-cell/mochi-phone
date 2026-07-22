# Mochi-phone

手机上传前后端版。

## 数据备份

此版本新增：

- 导出数据备份
- 导入数据恢复

用户换浏览器、换手机前，可以在“我的”页面点击“导出数据备份”，保存 JSON 文件。

换设备后打开网站，在“我的”页面点击“导入数据恢复”，选择备份 JSON 文件，即可恢复：

- 用户 ID
- 角色
- 对话
- 装扮
- 豆子余额
- 消费记录

Render：

- Build Command: `npm install`
- Start Command: `npm start`

环境变量最重要只需要：

```env
UPSTREAM_API_KEY=你的真实上游API密钥
```

此版本已内置：

```env
UPSTREAM_API_BASE=https://az.zlapi.vip/v1
UPSTREAM_MODEL=[0.005]自营伪流/gemini-2.5-flash
```
