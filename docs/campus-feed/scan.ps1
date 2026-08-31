# 批量探测浙江大学候选站点，输出结构化 JSON。
# 用法: pwsh -File "docs\campus-feed\scan.ps1"
param([string]$Candidates = "docs/campus-feed/zju-candidates.txt",
      [string]$Out = "docs/campus-feed/zju-scan.json")
$ErrorActionPreference = 'Continue'
foreach ($k in 'HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy') { Remove-Item Env:$k -ErrorAction SilentlyContinue }
$env:NO_PROXY = '127.0.0.1,localhost'
$lines = Get-Content $Candidates -ErrorAction SilentlyContinue | Where-Object { $_.Trim() -ne '' -and -not $_.Trim().StartsWith('#') }
$results = @()
foreach ($url in $lines) {
  $name = $url.Trim()
  $row = [ordered]@{ url=$name; status=''; charset=''; length=0; title=''; reachable=$false; redirect=''; note='' }
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    if ($attempt -gt 1) { Start-Sleep -Milliseconds 800 }
    try {
      $rsp = Invoke-WebRequest -Uri $name -UseBasicParsing -TimeoutSec 40 -MaximumRedirection 5
      $row.status = $rsp.StatusCode
      if ($rsp.Content -match 'charset=["'']?([A-Za-z0-9-]+)') { $row.charset = $matches[1] }
      $row.length = $rsp.Content.Length
      if ($rsp.Content -match '<title>([^<]+)</title>') { $row.title = ([System.Net.WebUtility]::HtmlDecode($matches[1])).Trim() }
      if ($rsp.StatusCode -ge 200 -and $rsp.StatusCode -lt 400) { $row.reachable = $true }
      try { if ($rsp.BaseResponse.RequestMessage.RequestUri) { $row.redirect = $rsp.BaseResponse.RequestMessage.RequestUri.AbsoluteUri } } catch {}
      break
    } catch {
      if ($attempt -eq 2) {
        $row.status = 'ERR'
        $row.note = $_.Exception.Message.Substring(0,[Math]::Min(80,$_.Exception.Message.Length))
      }
    }
  }
  $results += $row
  $st = if($row.status -eq 'ERR'){'ERR'}else{$row.status}
  $hostPart = ($name -split '//')[1] -split '/' | Select-Object -First 1
  $ttl = if($row.title.Length -gt 28){$row.title.Substring(0,28)}else{$row.title}
  Write-Host ("{0,-5} {1,-16} len={2,-7} {3}" -f $st, $hostPart, $row.length, $ttl)
}
$results | ConvertTo-Json -Depth 4 | Out-File $Out -Encoding UTF8
Write-Host ("`nWrote {0} entries -> {1}" -f $results.Count, $Out)
