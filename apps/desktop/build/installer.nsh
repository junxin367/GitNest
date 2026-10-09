!ifndef BUILD_UNINSTALLER
  !include "nsDialogs.nsh"
  !include "WordFunc.nsh"

  Var GitNestExisting
  Var GitNestExistingVersion
  Var GitNestExistingFolder
  Var GitNestAction
  Var GitNestDowngrade
  Var GitNestConfirmation

  ; Called after initMultiUser, so the selected scope and registry view are set.
  !macro customInit
    Call GitNestDetectExisting
  !macroend

  !macro customInstallMode
    Call GitNestDetectExisting
    ${If} $GitNestExisting == "1"
      ${If} $hasPerUserInstallation == "1"
      ${AndIf} $hasPerMachineInstallation == "0"
        StrCpy $isForceCurrentInstall "1"
      ${ElseIf} $hasPerMachineInstallation == "1"
      ${AndIf} $hasPerUserInstallation == "0"
        StrCpy $isForceMachineInstall "1"
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customWelcomePage
    ; Extend the stock page guard; do not pretend manual repair is --updated.
    !macroundef skipPageIfUpdated
    !include "${BUILD_RESOURCES_DIR}\installer-pages.nsh"
  !macroend

  !macro customPageAfterChangeDir
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !define MUI_PAGE_CUSTOMFUNCTION_PRE GitNestInstFilesPre
    Page custom GitNestMaintenancePage GitNestMaintenanceLeave
  !macroend

  !macro customHeader
    LangString GitNestTitle ${LANG_ENGLISH} "GitNest is already installed"
    LangString GitNestTitle ${LANG_SIMPCHINESE} "已安装 GitNest"
    LangString GitNestSubtitle ${LANG_ENGLISH} "Confirm the action for your existing installation."
    LangString GitNestSubtitle ${LANG_SIMPCHINESE} "确认对现有安装执行的操作。"
    LangString GitNestVersions ${LANG_ENGLISH} "Installed version: $GitNestExistingVersion$\r$\nInstaller version: ${VERSION}"
    LangString GitNestVersions ${LANG_SIMPCHINESE} "已安装版本：$GitNestExistingVersion$\r$\n安装包版本：${VERSION}"
    LangString GitNestLocation ${LANG_ENGLISH} "Existing installation folder (kept):"
    LangString GitNestLocation ${LANG_SIMPCHINESE} "沿用安装位置："
    LangString GitNestKeepData ${LANG_ENGLISH} "Your workspaces and settings will be kept. If GitNest is running, Setup will ask you to close it."
    LangString GitNestKeepData ${LANG_SIMPCHINESE} "工作区和设置将保留。若 GitNest 正在运行，安装时会提示关闭。"
    LangString GitNestUpdate ${LANG_ENGLISH} "Update"
    LangString GitNestUpdate ${LANG_SIMPCHINESE} "更新"
    LangString GitNestRepair ${LANG_ENGLISH} "Reinstall"
    LangString GitNestRepair ${LANG_SIMPCHINESE} "重新安装"
    LangString GitNestDowngradeAction ${LANG_ENGLISH} "Downgrade"
    LangString GitNestDowngradeAction ${LANG_SIMPCHINESE} "安装旧版"
    LangString GitNestDowngradeConsent ${LANG_ENGLISH} "I want to replace the newer installed version with this older version."
    LangString GitNestDowngradeConsent ${LANG_SIMPCHINESE} "我确认使用此旧版本覆盖已安装的新版本。"
    LangString GitNestUnknownVersion ${LANG_ENGLISH} "Unknown"
    LangString GitNestUnknownVersion ${LANG_SIMPCHINESE} "未知"

    Function GitNestDetectExisting
      StrCpy $GitNestExisting "0"
      StrCpy $GitNestExistingVersion ""
      StrCpy $GitNestExistingFolder ""
      ReadRegStr $GitNestExistingFolder SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $GitNestExistingFolder == ""
        Return
      ${EndIf}
      ; Respect explicit /D overrides and do not shortcut stale registry entries.
      ${If} $INSTDIR != $GitNestExistingFolder
        Return
      ${EndIf}
      ${IfNot} ${FileExists} "$GitNestExistingFolder\${APP_EXECUTABLE_FILENAME}"
      ${AndIfNot} ${FileExists} "$GitNestExistingFolder\${UNINSTALL_FILENAME}"
        Return
      ${EndIf}
      ReadRegStr $GitNestExistingVersion SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
      StrCpy $GitNestExisting "1"
    FunctionEnd

    Function GitNestSkipExistingPage
      ${If} ${isUpdated}
        Abort
      ${EndIf}
      Call GitNestDetectExisting
      ${If} $GitNestExisting == "1"
        Abort
      ${EndIf}
    FunctionEnd

    Function GitNestInstFilesPre
      ${If} $GitNestExisting == "1"
        StrCpy $INSTDIR "$GitNestExistingFolder"
      ${Else}
        Call instFilesPre
      ${EndIf}
    FunctionEnd

    Function GitNestDirectoryShow
      ; The maintenance page is skipped for a fresh install, so this starts it.
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:$(^InstallBtn)"
    FunctionEnd

    Function GitNestMaintenancePage
      ${If} ${isUpdated}
        Abort
      ${EndIf}
      Call GitNestDetectExisting
      ${If} $GitNestExisting != "1"
        Abort
      ${EndIf}

      StrCpy $GitNestDowngrade "0"
      StrCpy $GitNestAction "$(GitNestRepair)"
      ${If} $GitNestExistingVersion == ""
        StrCpy $GitNestExistingVersion "$(GitNestUnknownVersion)"
      ${Else}
        ${VersionCompare} "${VERSION}" "$GitNestExistingVersion" $0
        ${If} $0 == "1"
          StrCpy $GitNestAction "$(GitNestUpdate)"
        ${ElseIf} $0 == "2"
          StrCpy $GitNestAction "$(GitNestDowngradeAction)"
          StrCpy $GitNestDowngrade "1"
        ${EndIf}
      ${EndIf}

      !insertmacro MUI_HEADER_TEXT "$(GitNestTitle)" "$(GitNestSubtitle)"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        ; Do not start installing if the confirmation page cannot be created.
        Quit
      ${EndIf}
      ${NSD_CreateLabel} 0u 0u 100% 28u "$(GitNestVersions)"
      Pop $0
      ${NSD_CreateLabel} 0u 36u 100% 12u "$(GitNestLocation)"
      Pop $0
      ${NSD_CreateText} 0u 51u 100% 14u "$GitNestExistingFolder"
      Pop $0
      SendMessage $0 ${EM_SETREADONLY} 1 0
      ${NSD_CreateLabel} 0u 77u 100% 32u "$(GitNestKeepData)"
      Pop $0
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:$GitNestAction"
      EnableWindow $0 1
      ; There is no previous page when the existing scope was selected for us.
      ${If} $hasPerUserInstallation == "0"
      ${OrIf} $hasPerMachineInstallation == "0"
      ${OrIf} $isForceCurrentInstall == "1"
      ${OrIf} $isForceMachineInstall == "1"
        GetDlgItem $0 $HWNDPARENT 3
        EnableWindow $0 0
      ${EndIf}
      ${If} $GitNestDowngrade == "1"
        ${NSD_CreateCheckbox} 0u 116u 100% 28u "$(GitNestDowngradeConsent)"
        Pop $GitNestConfirmation
        ${NSD_OnClick} $GitNestConfirmation GitNestConfirmDowngrade
        GetDlgItem $0 $HWNDPARENT 1
        EnableWindow $0 0
      ${EndIf}
      nsDialogs::Show
    FunctionEnd

    Function GitNestConfirmDowngrade
      Pop $0
      ${NSD_GetState} $GitNestConfirmation $1
      GetDlgItem $0 $HWNDPARENT 1
      EnableWindow $0 $1
    FunctionEnd

    Function GitNestMaintenanceLeave
      ${If} $GitNestDowngrade == "1"
        ${NSD_GetState} $GitNestConfirmation $0
        ${If} $0 != ${BST_CHECKED}
          Abort
        ${EndIf}
      ${EndIf}
      ; Preserve the registered directory exactly, including custom names.
      StrCpy $INSTDIR "$GitNestExistingFolder"
    FunctionEnd
  !macroend
!endif
