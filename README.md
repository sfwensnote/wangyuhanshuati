# 砺题 · 比武练兵个人刷题

基于题库 Excel 制作的纯静态个人练习网站。题库共 2,238 道有效题目，涵盖单选、多选和判断题。题目数据拆分存放在 `questions/` 目录，页面会加载这些数据并整合为题库。网站无需账号或后端；答题进度、错题、收藏和学习日期保存在当前浏览器的 `localStorage` 中。

## 本地运行

直接用浏览器打开 `index.html` 可能会限制题库 JSON 的读取。建议在项目目录启动一个静态文件服务器：

```bash
python -m http.server 8000
```

然后访问 `http://localhost:8000`。

## 部署

GitHub Actions 会在推送到 `main` 分支后，把仓库根目录部署到 GitHub Pages。首次使用需要在仓库 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。

## 隐私

网站不调用账号、分析或题库 API；个人学习记录只留在本机浏览器。清除浏览器站点数据会删除这些记录。

