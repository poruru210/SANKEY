# シンプルバッチ登録スクリプト
param(
    [string]$BatchFile = ".\batch-request.json",
    [string]$Region = "ap-northeast-1",
    [string]$Profile = "poruru"
)

Write-Host "=== シンプル バッチ登録 ===" -ForegroundColor Green

# ファイル存在確認
if (-not (Test-Path $BatchFile)) {
    Write-Error "バッチファイルが見つかりません: $BatchFile"
    exit 1
}

# AWS SSOログイン確認
try {
    $identity = aws sts get-caller-identity --profile $Profile --output json | ConvertFrom-Json
    Write-Host "✅ AWS Identity: $($identity.Account)" -ForegroundColor Green
} catch {
    Write-Error "AWS SSOにログインしてください: aws sso login --profile $Profile"
    exit 1
}

Write-Host "🚀 バッチ登録実行中..." -ForegroundColor Yellow

# 直接AWS CLIコマンド実行
try {
    $result = aws dynamodb batch-write-item --request-items file://$BatchFile --region $Region --profile $Profile 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ バッチ登録成功!" -ForegroundColor Green

        # 結果を解析
        if ($result) {
            $resultObj = $result | ConvertFrom-Json
            if ($resultObj.UnprocessedItems -and $resultObj.UnprocessedItems.PSObject.Properties.Count -gt 0) {
                Write-Host "⚠️  未処理アイテムがあります:" -ForegroundColor Yellow
                Write-Host ($resultObj.UnprocessedItems | ConvertTo-Json -Depth 5) -ForegroundColor Yellow
            } else {
                Write-Host "✅ 全てのアイテムが正常に処理されました" -ForegroundColor Green
            }
        }

    } else {
        Write-Host "❌ バッチ登録失敗:" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ エラー: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# テーブル確認
Write-Host "`n📊 テーブル確認中..." -ForegroundColor Yellow
try {
    # テーブル名を動的に取得
    $tableName = aws cloudformation describe-stacks --stack-name "LicenseServiceDbStack" --query 'Stacks[0].Outputs[?OutputKey==`EAApplicationsTableName`].OutputValue' --output text --region $Region --profile $Profile

    if ($tableName -and $tableName -ne "None") {
        $itemCount = aws dynamodb scan --table-name $tableName --select COUNT --region $Region --profile $Profile --query 'Count' --output text
        Write-Host "✅ 総アイテム数: $itemCount" -ForegroundColor Green

        if ([int]$itemCount -gt 0) {
            Write-Host "`n📋 サンプルデータ:" -ForegroundColor Cyan
            $sampleData = aws dynamodb scan --table-name $tableName --limit 3 --region $Region --profile $Profile --output json | ConvertFrom-Json

            foreach ($item in $sampleData.Items) {
                $eaName = $item.eaName.S
                $status = $item.status.S
                $userId = $item.userId.S
                Write-Host "  - $eaName ($status) - User: $userId" -ForegroundColor White
            }
        }
    }
} catch {
    Write-Warning "テーブル確認に失敗しました"
}

Write-Host "`n🎉 完了!" -ForegroundColor Green
