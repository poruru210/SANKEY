"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"

type Language = "en" | "ja"

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
}

const translations = {
  en: {
    // Actions
    "actions.approve": "Approve",
    "actions.back": "Back",
    "actions.cancel": "Cancel",
    "actions.close": "Close",
    "actions.copy": "Copy",
    "actions.deactivate": "Deactivate",
    "actions.reject": "Reject",
    "actions.save": "Save",
    "actions.stopSending": "Stop Sending",

    // Common
    "common.authentication": "Authentication",
    "common.dismiss": "Dismiss",
    "common.error": "Error",
    "common.failedToLoad": "Failed to load applications",
    "common.loading": "Loading...",
    "common.loadingApplications": "Loading applications...",
    "common.pleaseWait": "Please wait...",
    "common.processing": "Processing...",
    "common.refresh": "Refresh",
    "common.retry": "Retry",
    "common.success": "Success",

    // Dashboard
    "dashboard.activeApplications": "Active Licenses",
    "dashboard.allTimeIssued": "All time issued",
    "dashboard.awaitingApproval": "Awaiting approval",
    "dashboard.currentlyActive": "Currently active",
    "dashboard.expiringSoon": "Expiring Soon",
    "dashboard.pendingApplications": "Pending Applications",
    "dashboard.subtitle": "Manage EA license applications and approvals",
    "dashboard.title": "License Management Dashboard",
    "dashboard.totalIssued": "Total Issued",
    "dashboard.within30Days": "Within 30 days",

    // Developer Guide
    "developer.apiReference": "API Reference",
    "developer.apiReferenceDesc": "Available functions and their usage",
    "developer.bestPractices": "Best Practices",
    "developer.bestPracticesDesc": "Recommendations for secure license implementation",
    "developer.cacheResults": "Cache license verification results",
    "developer.dllDesc": "Windows DLL for license verification functions",
    "developer.dllLibrary": "DLL Library",
    "developer.docDesc": "Complete API reference and examples",
    "developer.documentation": "Documentation",
    "developer.downloadDll": "Download DLL",
    "developer.downloadMqh": "Download MQH",
    "developer.getLicenseInfoDesc": "Retrieves detailed information about the license.",
    "developer.getLicenseInfoReturn": "JSON string with license details",
    "developer.handleFailures": "Handle license failures gracefully",
    "developer.handleTimeouts": "Handle network timeouts",
    "developer.integrationGuide": "EA License Integration Guide",
    "developer.integrationGuideDesc": "Complete guide for integrating SANKEY license verification into your Expert Advisors",
    "developer.integrationSteps": "Integration Steps",
    "developer.integrationStepsDesc": "Step-by-step guide to integrate SANKEY license verification",
    "developer.limitFrequency": "Limit verification frequency",
    "developer.mqhDesc": "Include our header file for easy license verification",
    "developer.mqhLibrary": "MQH Library",
    "developer.obfuscateKey": "Obfuscate your license key in the code",
    "developer.offlineGrace": "Implement offline grace period",
    "developer.parameters": "Parameters:",
    "developer.performance": "Performance",
    "developer.periodicChecks": "Perform periodic license checks",
    "developer.returns": "Returns:",
    "developer.security": "Security",
    "developer.step1Comment": "Files needed:",
    "developer.step1Desc": "Download the SANKEY MQH header file and DLL library from the links above.",
    "developer.step1Title": "Download Required Files",
    "developer.step2Desc": "Add the SANKEY header file to your EA and import the necessary functions.",
    "developer.step2Title": "Include Header File",
    "developer.step3Desc": "Add license verification in your EA's OnInit() function.",
    "developer.step3Title": "Initialize License Check",
    "developer.step4Comment1": "Check license every hour",
    "developer.step4Comment2": "Your EA logic here...",
    "developer.step4Desc": "Add periodic license checks to prevent unauthorized usage.",
    "developer.step4Title": "Periodic Verification",
    "developer.subtitle": "Complete guide for integrating SANKEY license verification into your Expert Advisors",
    "developer.title": "Developer Integration Guide",
    "developer.useEncryption": "Use encrypted communication",
    "developer.verifyLicenseDesc": "Verifies if the provided license key is valid for the given account number.",
    "developer.verifyLicenseReturn": "true if license is valid, false otherwise",
    "developer.viewDocs": "View Docs",

    // Dialog
    "dialog.approveDescription": "Are you sure you want to approve this application? A license key will be issued to the user.",
    "dialog.approveTitle": "Approve Application",
    "dialog.deactivateMessage": "Are you sure you want to deactivate the license for",
    "dialog.deactivateTitle": "Confirm License Deactivation",
    "dialog.deactivateWarning": "This action cannot be undone. The license will be deactivated during the next license check.",
    "dialog.decryptedLicense": "Decrypted License",
    "dialog.decryptionFailed": "Failed to decrypt license",
    "dialog.decrypting": "Decrypting...",
    "dialog.licenseInfo": "License Information",
    "dialog.licenseInfoDescription": "Display decrypted license information",
    "dialog.licenseWarning": "This license information is confidential. Please manage it securely.",
    "dialog.rejectMessage": "Are you sure you want to reject the application for",
    "dialog.rejectTitle": "Confirm Application Rejection",
    "dialog.rejectWarning": "This action cannot be undone. The application will be permanently rejected.",
    "dialog.sendingScheduleStatus": "Sending Schedule Status",
    "dialog.stopSendingDescription": "Are you sure you want to stop sending this notification? The scheduled sending will be cancelled.",
    "dialog.stopSendingTitle": "Stop Sending",
    "dialog.target": "Target",

    // Fields
    "fields.account": "Account",
    "fields.applied": "Applied",
    "fields.approved": "Approved",
    "fields.broker": "Broker",
    "fields.expires": "Expires",
    "fields.id": "ID",
    "fields.issued": "Issued",

    // Filters
    "filters.accountNumber": "Account Number",
    "filters.advancedSearch": "Advanced Search",
    "filters.allBrokers": "All Brokers",
    "filters.broker": "Broker",
    "filters.clearFilters": "Clear Filters",
    "filters.eaName": "EA Name",
    "filters.hideAdvanced": "Hide Advanced",
    "filters.searchAccount": "Search account...",
    "filters.searchEaName": "Search EA name...",
    "filters.searchXAccount": "Search X account...",
    "filters.title": "Filters",
    "filters.xAccount": "X Account",

    // Footer
    "footer.copyright": "© 2024 SANKEY. All rights reserved.",
    "footer.securedBy": "Secured by advanced encryption",

    // Forgot Password
    "forgotPassword.backToLogin": "Back to Login",
    "forgotPassword.checkEmail": "Check your email for reset instructions",
    "forgotPassword.checkSpam": "If you don't see the email, please check your spam folder.",
    "forgotPassword.codeExpired": "Confirmation code has expired",
    "forgotPassword.codeInvalid": "Invalid confirmation code",
    "forgotPassword.emailInvalid": "Please enter a valid email address",
    "forgotPassword.emailPlaceholder": "Enter your email address",
    "forgotPassword.emailRequired": "Email address is required",
    "forgotPassword.emailSent": "Email Sent!",
    "forgotPassword.emailSentTo": "We've sent password reset instructions to:",
    "forgotPassword.instructions": "We'll send you a link to reset your password.",
    "forgotPassword.nextSteps": "Next Steps:",
    "forgotPassword.resendEmail": "Didn't receive the email? Send again",
    "forgotPassword.sendFailed": "Failed to send reset email. Please try again.",
    "forgotPassword.sendReset": "Send Reset Link",
    "forgotPassword.sending": "Sending...",
    "forgotPassword.step1": "Check your email inbox for a message from SANKEY",
    "forgotPassword.step2": "Click the reset link in the email",
    "forgotPassword.step3": "Follow the instructions to create a new password",
    "forgotPassword.subtitle": "Enter your email to receive reset instructions",
    "forgotPassword.title": "Reset Password",

    // Login
    "login.accessDenied": "Access denied",
    "login.additionalAuth": "Additional authentication required",
    "login.authError": "Authentication error occurred",
    "login.checkingAuth": "Checking authentication...",
    "login.configurationError": "Configuration error occurred",
    "login.demoAccess": "Demo Access",
    "login.demoNote": "Any valid email format and 4+ character password will work",
    "login.email": "Email Address",
    "login.emailPlaceholder": "admin@sankey.com",
    "login.enterpriseSecurity": "Enterprise-grade security",
    "login.enterEmailPassword": "Please enter both email and password",
    "login.forgotPassword": "Forgot your password?",
    "login.hostedUIDescription": "Secure authentication with AWS Cognito",
    "login.invalidCredentials": "Invalid email or password",
    "login.invalidEmail": "Please enter a valid email address",
    "login.loginFailed": "Login failed. Please try again.",
    "login.mfaSupport": "Multi-factor authentication (MFA) support",
    "login.noAuthResult": "No authentication result received",
    "login.noRefreshToken": "No refresh token available",
    "login.password": "Password",
    "login.passwordPlaceholder": "Enter your password",
    "login.redirectNotice": "You will be redirected to a secure login page",
    "login.securedBy": "Secured by advanced encryption",
    "login.securingAccess": "Ensuring secure access",
    "login.securityFeatures": "Security Features",
    "login.sessionExpired": "Session expired, please login again",
    "login.signIn": "Sign In",
    "login.signingIn": "Signing in...",
    "login.signUp": "Sign Up",
    "login.signUpPrompt": "Don't have an account?",
    "login.socialLogin": "Social login support",
    "login.subtitle": "EA License Management System",
    "login.title": "SANKEY",
    "login.tooManyRequests": "Too many requests. Please try again later",
    "login.userNotConfirmed": "Email verification required",
    "login.userNotFound": "User not found",
    "login.verificationError": "Verification error occurred",

    // Logout
    "logout.confirmMessage": "Are you sure you want to log out?",
    "logout.confirmTitle": "Confirm Logout",
    "logout.error": "Logout failed. Please try again.",
    "logout.loggingOut": "Logging out...",
    "logout.success": "Successfully logged out",

    // Navigation
    "nav.dashboard": "License Dashboard",
    "nav.developer": "Developer Guide",
    "nav.menu": "Menu",
    "nav.settings": "Settings",
    "nav.signOut": "Sign Out",

    // Pagination
    "pagination.applications": "applications",
    "pagination.historyRecords": "history records",
    "pagination.licenses": "licenses",
    "pagination.of": "of",
    "pagination.showing": "Showing",
    "pagination.to": "to",

    // Settings
    "settings.active": "active",
    "settings.activeLicenses": "Active Licenses",
    "settings.apiCalls": "API Calls",
    "settings.changePlan": "Change Plan",
    "settings.choosePlan": "Choose the plan that best fits your needs",
    "settings.currentPlan": "Current Plan",
    "settings.customDays": "Custom Days",
    "settings.darkMode": "Dark Mode",
    "settings.days": "days",
    "settings.displaySettings": "Display Settings",
    "settings.displaySettingsDesc": "Customize your dashboard appearance and behavior",
    "settings.itemsPerPage": "Items per page",
    "settings.itemsPerPageDesc": "Number of items to display per page in tables",
    "settings.language": "Language",
    "settings.languageDesc": "Select your preferred language",
    "settings.licenseExpiration": "License Expiration",
    "settings.licenseExpirationDesc": "Set the default expiration period for new licenses",
    "settings.licenseSettings": "License Settings",
    "settings.licenseSettingsDesc": "Configure default license generation settings",
    "settings.lightMode": "Light Mode",
    "settings.masterKey": "Master Key",
    "settings.masterKeyDesc": "This key is used for license generation and verification",
    "settings.monthlyLicenses": "Monthly Licenses",
    "settings.of": "of",
    "settings.planBasicDescription": "Great for small businesses",
    "settings.planDescription": "Manage your subscription and view usage statistics",
    "settings.planFreeDescription": "Perfect for getting started",
    "settings.planProDescription": "Unlimited access for enterprises",
    "settings.subtitle": "Configure your dashboard preferences",
    "settings.theme": "Theme",
    "settings.themeDesc": "Choose your preferred theme",
    "settings.thisMonth": "this month",
    "settings.title": "Settings",
    "settings.unlimited": "Unlimited",
    "settings.updatePlan": "Update Plan",
    "settings.used": "used",

    // Status
    "status.active": "Active",
    "status.awaitingNotification": "Awaiting Notification",
    "status.cancelled": "Cancelled",
    "status.deactivated": "Deactivated",
    "status.expired": "Expired",
    "status.pending": "Pending",
    "status.rejected": "Rejected",
    "status.revoked": "Revoked",

    // Tabs
    "tabs.active": "Active Licenses",
    "tabs.activeDescription": "Currently active EA licenses",
    "tabs.activeShort": "Active",
    "tabs.history": "Issue History",
    "tabs.historyDescription": "Complete history of license issuance",
    "tabs.historyShort": "History",
    "tabs.noActiveLicenses": "No active licenses found",
    "tabs.noLicenseHistory": "No license history found",
    "tabs.noPendingApplications": "No pending applications found",
    "tabs.pending": "Pending Applications",
    "tabs.pendingDescription": "Review and approve EA license applications",
    "tabs.pendingShort": "Pending",

    // Toast Messages
    "toast.error": "Error",
    "toast.info": "Information",
    "toast.licenseKeyCopied": "License key copied!",
    "toast.licenseKeyCopiedDesc": "The license key has been copied to your clipboard.",
    "toast.success": "Success",
    "toast.warning": "Warning",
  },
  ja: {
    // Actions
    "actions.approve": "承認",
    "actions.back": "戻る",
    "actions.cancel": "キャンセル",
    "actions.close": "閉じる",
    "actions.copy": "コピー",
    "actions.deactivate": "無効化",
    "actions.reject": "却下",
    "actions.save": "保存",
    "actions.stopSending": "送信停止",

    // Common
    "common.authentication": "認証",
    "common.dismiss": "閉じる",
    "common.error": "エラー",
    "common.failedToLoad": "アプリケーションの読み込みに失敗しました",
    "common.loading": "読み込み中...",
    "common.loadingApplications": "アプリケーション読み込み中...",
    "common.pleaseWait": "お待ちください...",
    "common.processing": "処理中...",
    "common.refresh": "更新",
    "common.retry": "再試行",
    "common.success": "成功",

    // Dashboard
    "dashboard.activeApplications": "有効なライセンス",
    "dashboard.allTimeIssued": "累計発行数",
    "dashboard.awaitingApproval": "承認待ち",
    "dashboard.currentlyActive": "現在有効",
    "dashboard.expiringSoon": "期限切れ間近",
    "dashboard.pendingApplications": "申請待ち",
    "dashboard.subtitle": "EAライセンスの申請と承認を管理",
    "dashboard.title": "ライセンス管理ダッシュボード",
    "dashboard.totalIssued": "発行済み総数",
    "dashboard.within30Days": "30日以内",

    // Developer Guide
    "developer.accountNumberParam": "MT4/MT5アカウント番号",
    "developer.apiReference": "APIリファレンス",
    "developer.apiReferenceDesc": "利用可能な関数とその使用方法",
    "developer.bestPractices": "ベストプラクティス",
    "developer.bestPracticesDesc": "安全なライセンス実装のための推奨事項",
    "developer.cacheResults": "ライセンス認証結果をキャッシュする",
    "developer.dllDesc": "ライセンス認証機能用Windows DLL",
    "developer.dllLibrary": "DLLライブラリ",
    "developer.docDesc": "完全なAPIリファレンスと例",
    "developer.documentation": "ドキュメント",
    "developer.downloadDll": "DLLをダウンロード",
    "developer.downloadMqh": "MQHをダウンロード",
    "developer.getLicenseInfoDesc": "ライセンスに関する詳細情報を取得します。",
    "developer.getLicenseInfoReturn": "ライセンス詳細を含むJSON文字列",
    "developer.handleFailures": "ライセンス失敗を適切に処理する",
    "developer.handleTimeouts": "ネットワークタイムアウトを処理する",
    "developer.integrationGuide": "EAライセンス統合ガイド",
    "developer.integrationGuideDesc": "Expert AdvisorにSANKEYライセンス認証を統合するための完全ガイド",
    "developer.integrationSteps": "統合手順",
    "developer.integrationStepsDesc": "SANKEYライセンス認証を統合するためのステップバイステップガイド",
    "developer.licenseKeyParam": "認証するライセンスキー",
    "developer.licenseKeyQueryParam": "クエリするライセンスキー",
    "developer.limitFrequency": "認証頻度を制限する",
    "developer.mqhDesc": "簡単なライセンス認証のためのヘッダーファイル",
    "developer.mqhLibrary": "MQHライブラリ",
    "developer.obfuscateKey": "コード内でライセンスキーを難読化する",
    "developer.offlineGrace": "オフライン猶予期間を実装する",
    "developer.parameters": "パラメータ:",
    "developer.performance": "パフォーマンス",
    "developer.periodicChecks": "定期的なライセンスチェックを実行する",
    "developer.returns": "戻り値:",
    "developer.security": "セキュリティ",
    "developer.step1Comment": "必要なファイル:",
    "developer.step1Desc": "上記のリンクからSANKEY MQHヘッダーファイルとDLLライブラリをダウンロードします。",
    "developer.step1Title": "必要なファイルをダウンロード",
    "developer.step2Desc": "SANKEYヘッダーファイルをEAに追加し、必要な関数をインポートします。",
    "developer.step2Title": "ヘッダーファイルをインクルード",
    "developer.step3Desc": "EAのOnInit()関数にライセンス認証を追加します。",
    "developer.step3Title": "ライセンスチェックを初期化",
    "developer.step4Comment1": "1時間ごとにライセンスをチェック",
    "developer.step4Comment2": "ここにEAのロジックを記述...",
    "developer.step4Desc": "不正使用を防ぐために定期的なライセンスチェックを追加します。",
    "developer.step4Title": "定期的な認証",
    "developer.subtitle": "Expert AdvisorにSANKEYライセンス認証を統合するための完全ガイド",
    "developer.title": "開発者統合ガイド",
    "developer.useEncryption": "暗号化通信を使用する",
    "developer.verifyLicenseDesc": "指定されたライセンスキーが指定されたアカウント番号に対して有効かどうかを確認します。",
    "developer.verifyLicenseReturn": "ライセンスが有効な場合はtrue、そうでなければfalse",
    "developer.viewDocs": "ドキュメントを見る",

    // Dialog
    "dialog.approveDescription": "このアプリケーションを承認してもよろしいですか？ユーザーにライセンスキーが発行されます。",
    "dialog.approveTitle": "アプリケーションの承認",
    "dialog.deactivateMessage": "以下のライセンスを無効化してもよろしいですか",
    "dialog.deactivateTitle": "ライセンス無効化の確認",
    "dialog.deactivateWarning": "この操作は取り消せません。次回のライセンスチェック時に無効化されます。",
    "dialog.decryptedLicense": "復号化されたライセンス",
    "dialog.decryptionFailed": "ライセンスの復号化に失敗しました",
    "dialog.decrypting": "復号化しています...",
    "dialog.licenseInfo": "ライセンス情報",
    "dialog.licenseInfoDescription": "復号化されたライセンス情報を表示します",
    "dialog.licenseWarning": "このライセンス情報は機密です。安全に管理してください。",
    "dialog.rejectMessage": "以下の申請を却下してもよろしいですか",
    "dialog.rejectTitle": "申請却下の確認",
    "dialog.rejectWarning": "この操作は取り消せません。申請は完全に却下されます。",
    "dialog.sendingScheduleStatus": "送信スケジュール状況",
    "dialog.stopSendingDescription": "この通知の送信を停止してもよろしいですか？スケジュールされた送信が中止されます。",
    "dialog.stopSendingTitle": "送信の停止",
    "dialog.target": "対象",

    // Fields
    "fields.account": "アカウント",
    "fields.applied": "申請日",
    "fields.approved": "承認日",
    "fields.broker": "ブローカー",
    "fields.expires": "有効期限",
    "fields.id": "ID",
    "fields.issued": "発行日",

    // Filters
    "filters.accountNumber": "アカウント番号",
    "filters.advancedSearch": "詳細検索",
    "filters.allBrokers": "全てのブローカー",
    "filters.broker": "ブローカー",
    "filters.clearFilters": "フィルターをクリア",
    "filters.eaName": "EA名",
    "filters.hideAdvanced": "詳細検索を隠す",
    "filters.searchAccount": "アカウントを検索...",
    "filters.searchEaName": "EA名を検索...",
    "filters.searchXAccount": "Xアカウントを検索...",
    "filters.title": "フィルター",
    "filters.xAccount": "Xアカウント",

    // Footer
    "footer.copyright": "© 2024 SANKEY. All rights reserved.",
    "footer.securedBy": "高度な暗号化により保護",

    // Forgot Password
    "forgotPassword.backToLogin": "ログインに戻る",
    "forgotPassword.checkEmail": "リセット手順についてメールをご確認ください",
    "forgotPassword.checkSpam": "メールが見つからない場合は、迷惑メールフォルダをご確認ください。",
    "forgotPassword.codeExpired": "確認コードの有効期限が切れています",
    "forgotPassword.codeInvalid": "確認コードが正しくありません",
    "forgotPassword.emailInvalid": "有効なメールアドレスを入力してください",
    "forgotPassword.emailPlaceholder": "メールアドレスを入力",
    "forgotPassword.emailRequired": "メールアドレスが必要です",
    "forgotPassword.emailSent": "メール送信完了！",
    "forgotPassword.emailSentTo": "パスワードリセット手順を以下のアドレスに送信しました：",
    "forgotPassword.instructions": "パスワードをリセットするためのリンクをお送りします。",
    "forgotPassword.nextSteps": "次のステップ：",
    "forgotPassword.resendEmail": "メールが届きませんか？再送信",
    "forgotPassword.sendFailed": "リセットメールの送信に失敗しました。もう一度お試しください。",
    "forgotPassword.sendReset": "リセットリンクを送信",
    "forgotPassword.sending": "送信中...",
    "forgotPassword.step1": "SANKEYからのメールをメールボックスで確認",
    "forgotPassword.step2": "メール内のリセットリンクをクリック",
    "forgotPassword.step3": "手順に従って新しいパスワードを作成",
    "forgotPassword.subtitle": "リセット手順を受け取るためにメールアドレスを入力してください",
    "forgotPassword.title": "パスワードリセット",

    // Login
    "login.accessDenied": "アクセスが拒否されました",
    "login.additionalAuth": "追加の認証が必要です",
    "login.authError": "認証エラーが発生しました",
    "login.checkingAuth": "認証状態を確認中...",
    "login.configurationError": "設定エラーが発生しました",
    "login.demoAccess": "デモアクセス",
    "login.demoNote": "有効なメール形式と4文字以上のパスワードで動作します",
    "login.email": "メールアドレス",
    "login.emailPlaceholder": "admin@sankey.com",
    "login.enterpriseSecurity": "エンタープライズグレードのセキュリティ",
    "login.enterEmailPassword": "メールアドレスとパスワードを入力してください",
    "login.forgotPassword": "パスワードを忘れましたか？",
    "login.hostedUIDescription": "AWS Cognitoによるセキュアな認証",
    "login.invalidCredentials": "メールアドレスまたはパスワードが正しくありません",
    "login.invalidEmail": "有効なメールアドレスを入力してください",
    "login.loginFailed": "ログインに失敗しました。再試行してください。",
    "login.mfaSupport": "多要素認証 (MFA) 対応",
    "login.noAuthResult": "認証結果を受信できませんでした",
    "login.noRefreshToken": "リフレッシュトークンがありません",
    "login.password": "パスワード",
    "login.passwordPlaceholder": "パスワードを入力",
    "login.redirectNotice": "セキュアなログインページにリダイレクトされます",
    "login.securedBy": "高度な暗号化により保護",
    "login.securingAccess": "セキュアなアクセスを確保しています",
    "login.securityFeatures": "セキュリティ機能",
    "login.sessionExpired": "セッションが期限切れです。再度ログインしてください",
    "login.signIn": "サインイン",
    "login.signingIn": "サインイン中...",
    "login.signUp": "新規登録",
    "login.signUpPrompt": "アカウントをお持ちでない場合",
    "login.socialLogin": "ソーシャルログイン対応",
    "login.subtitle": "EAライセンス管理システム",
    "login.title": "SANKEY",
    "login.tooManyRequests": "リクエストが多すぎます。しばらく待ってから再試行してください",
    "login.userNotConfirmed": "メールアドレスの確認が必要です",
    "login.userNotFound": "ユーザーが見つかりません",
    "login.verificationError": "認証エラーが発生しました",

    // Logout
    "logout.confirmMessage": "ログアウトしてもよろしいですか？",
    "logout.confirmTitle": "ログアウトの確認",
    "logout.error": "ログアウトに失敗しました。再試行してください。",
    "logout.loggingOut": "ログアウト中...",
    "logout.success": "ログアウトしました",

    // Navigation
    "nav.dashboard": "ライセンス管理",
    "nav.developer": "開発者ガイド",
    "nav.documentation": "ドキュメント",
    "nav.menu": "メニュー",
    "nav.profile": "プロフィール",
    "nav.settings": "設定",
    "nav.signOut": "サインアウト",
    "nav.support": "サポート",

    // Pagination
    "pagination.applications": "件の申請",
    "pagination.historyRecords": "件の履歴",
    "pagination.licenses": "件のライセンス",
    "pagination.of": "/",
    "pagination.showing": "表示中",
    "pagination.to": "〜",

    // Settings
    "settings.active": "有効",
    "settings.activeLicenses": "有効ライセンス",
    "settings.apiCalls": "API呼び出し",
    "settings.changePlan": "プラン変更",
    "settings.choosePlan": "ニーズに最適なプランを選択してください",
    "settings.currentPlan": "現在のプラン",
    "settings.customDays": "カスタム日数",
    "settings.darkMode": "ダークモード",
    "settings.days": "日",
    "settings.displaySettings": "表示設定",
    "settings.displaySettingsDesc": "ダッシュボードの外観と動作をカスタマイズ",
    "settings.itemsPerPage": "ページあたりの項目数",
    "settings.itemsPerPageDesc": "テーブルに表示する項目数",
    "settings.language": "言語",
    "settings.languageDesc": "お好みの言語を選択",
    "settings.licenseExpiration": "ライセンス有効期限",
    "settings.licenseExpirationDesc": "新しいライセンスのデフォルト有効期限を設定",
    "settings.licenseSettings": "ライセンス設定",
    "settings.licenseSettingsDesc": "デフォルトのライセンス生成設定を構成",
    "settings.lightMode": "ライトモード",
    "settings.masterKey": "マスターキー",
    "settings.masterKeyDesc": "このキーはライセンスの生成と検証に使用されます",
    "settings.monthlyLicenses": "月間ライセンス",
    "settings.of": "/",
    "settings.planBasicDescription": "小規模ビジネスに最適",
    "settings.planDescription": "サブスクリプションを管理し、使用統計を確認",
    "settings.planFreeDescription": "始めるのに最適",
    "settings.planProDescription": "企業向け無制限アクセス",
    "settings.subtitle": "ダッシュボードの設定を変更",
    "settings.theme": "テーマ",
    "settings.themeDesc": "お好みのテーマを選択",
    "settings.thisMonth": "今月",
    "settings.title": "設定",
    "settings.unlimited": "無制限",
    "settings.updatePlan": "プラン更新",
    "settings.used": "使用済み",

    // Status
    "status.active": "有効",
    "status.awaitingNotification": "送信待ち",
    "status.cancelled": "中止",
    "status.deactivated": "無効化",
    "status.expired": "期限切れ",
    "status.pending": "申請中",
    "status.rejected": "却下",
    "status.revoked": "取り消し",

    // Tabs
    "tabs.active": "有効なライセンス",
    "tabs.activeDescription": "現在有効なEAライセンス",
    "tabs.activeShort": "有効",
    "tabs.history": "発行履歴",
    "tabs.historyDescription": "ライセンス発行の完全な履歴",
    "tabs.historyShort": "履歴",
    "tabs.noActiveLicenses": "有効なライセンスはありません",
    "tabs.noLicenseHistory": "ライセンス履歴はありません",
    "tabs.noPendingApplications": "申請待ちの項目はありません",
    "tabs.pending": "申請待ち",
    "tabs.pendingDescription": "EAライセンス申請の確認と承認",
    "tabs.pendingShort": "申請待ち",

    // Toast Messages
    "toast.error": "エラー",
    "toast.info": "情報",
    "toast.licenseKeyCopied": "ライセンスキーをコピーしました！",
    "toast.licenseKeyCopiedDesc": "ライセンスキーがクリップボードにコピーされました。",
    "toast.success": "成功",
    "toast.warning": "警告",
  },
}

const I18nContext = createContext<I18nContextType | undefined>(undefined)

const isValidLanguage = (lang: string | null): lang is Language => {
  return lang === "en" || lang === "ja"
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("en")
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    let determinedLanguage: Language | null = null
    const langFromUrl = searchParams.get("lang")

    if (isValidLanguage(langFromUrl)) {
      determinedLanguage = langFromUrl
    } else {
      const langFromLocalStorage = localStorage.getItem("language") as Language
      if (isValidLanguage(langFromLocalStorage)) {
        determinedLanguage = langFromLocalStorage
      } else {
        const browserLang = navigator.language
        if (browserLang.startsWith("ja")) {
          determinedLanguage = "ja"
        } else {
          determinedLanguage = "en"
        }
      }
    }

    if (determinedLanguage && language !== determinedLanguage) {
      setLanguage(determinedLanguage)
    }

    // Update URL if lang is not in searchParams or if it's different from determinedLanguage
    // This also runs on initial load to set the lang param if missing
    const currentQuery = new URLSearchParams(Array.from(searchParams.entries()))
    if (langFromUrl !== determinedLanguage) {
      currentQuery.set("lang", determinedLanguage as Language)
      const newSearch = currentQuery.toString()
      router.replace(`${pathname}?${newSearch}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams, router]) // Only run on mount and when essential routing params change

  useEffect(() => {
    localStorage.setItem("language", language)
    const currentQuery = new URLSearchParams(Array.from(searchParams.entries()))
    const langFromUrl = currentQuery.get("lang")

    if (langFromUrl !== language) {
      currentQuery.set("lang", language)
      // Remove other lang parameters if any exist to avoid duplicates
      const keysToDelete: string[] = []
      currentQuery.forEach((value, key) => {
        if (key !== "lang" && key.toLowerCase() === "lang") {
          keysToDelete.push(key)
        }
      })
      keysToDelete.forEach(key => currentQuery.delete(key))

      const newSearch = currentQuery.toString()
      router.replace(`${pathname}?${newSearch}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]) // Removed router, pathname, searchParams to avoid loop, only sync when internal language changes

  const t = (key: string): string => {
    return translations[language][key as keyof (typeof translations)[typeof language]] || key
  }

  return <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (context === undefined) {
    throw new Error("useI18n must be used within an I18nProvider")
  }
  return context
}