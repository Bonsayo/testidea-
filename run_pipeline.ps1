$log = "$env:USERPROFILE\Desktop\try\pipeline.log"
Set-Location "$env:USERPROFILE\Desktop\try"
npx tsx src/index.ts 2>&1 | Out-File $log -Append
