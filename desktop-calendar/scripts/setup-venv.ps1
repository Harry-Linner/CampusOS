# 创建 desktop-calendar 的自包含 Python 环境并安装 DeskToDo 依赖（PyQt6 等）。
# 首次使用 / 全新克隆后运行一次；.venv 已被 .gitignore 忽略，不会入库。
# 用法：在仓库根目录执行  powershell -ExecutionPolicy Bypass -File desktop-calendar\scripts\setup-venv.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # desktop-calendar/
$python = (Get-Command python -ErrorAction Stop).Source
Write-Host "using python: $python"
if (-not (Test-Path "$root\.venv\Scripts\python.exe")) {
    Write-Host "creating $root\.venv ..."
    & $python -m venv "$root\.venv"
}
$venvPy = "$root\.venv\Scripts\python.exe"
Write-Host "installing requirements into venv ..."
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -r "$root\requirements.txt"
Write-Host "done. DeskToDo venv ready (use: $venvPy -m deskcal.main from $root)"
