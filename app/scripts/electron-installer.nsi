Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "nsDialogs.nsh"
!insertmacro VersionCompare

!ifndef PRODUCT_VERSION
 !error "PRODUCT_VERSION is required"
!endif
!ifndef INSTALL_KEY
 !define INSTALL_KEY "Software\Antonio Fradique\Go Streams\Electron"
!endif
!ifndef UNINSTALL_KEY
 !define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\GoStreams.Electron"
!endif
Name "Go Streams ${PRODUCT_VERSION}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Go Streams Electron"
InstallDirRegKey HKCU "${INSTALL_KEY}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "Go Streams - Antonio Fradique"
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"
ShowInstDetails show
ShowUninstDetails show
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\GoStreams.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Go Streams"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom LegacyDataPage LegacyDataLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Portuguese"
!insertmacro MUI_LANGUAGE "PortugueseBR"
!insertmacro MUI_LANGUAGE "Spanish"

Var LegacyFolder
Var LegacyInput
Var ShortcutDesktop
Var ShortcutMenu
Var DataRoot

Function .onInit
 SetShellVarContext current
 SetRegView 64
 StrCpy $ShortcutDesktop "$DESKTOP"
 StrCpy $ShortcutMenu "$SMPROGRAMS\Go Streams"
 StrCpy $DataRoot "$LOCALAPPDATA\Go Streams"
 !ifdef TEST_ROOT
  StrCpy $ShortcutDesktop "${TEST_ROOT}\Desktop"
  StrCpy $ShortcutMenu "${TEST_ROOT}\StartMenu\Go Streams"
  StrCpy $DataRoot "${TEST_ROOT}\UserData"
 !endif
 ReadRegStr $LegacyFolder HKCU "Software\Antonio Fradique\Go Streams" "LegacyDataDirectory"
 ReadRegStr $0 HKCU "${INSTALL_KEY}" "DisplayVersion"
 ${If} $0 != ""
  ${VersionCompare} "$0" "${PRODUCT_VERSION}" $1
  ${If} $1 == 1
   MessageBox MB_OK|MB_ICONEXCLAMATION "A newer Go Streams Electron is already installed. Your data was preserved." /SD IDOK
   SetErrorLevel 2
   Abort
  ${EndIf}
 ${EndIf}
FunctionEnd

Function .onVerifyInstDir
 GetFullPathName $0 "$INSTDIR"
 ${GetRoot} "$0" $1
 ${If} $0 == $1
  Abort
 ${EndIf}
 ${If} $0 == "$LOCALAPPDATA"
 ${OrIf} $0 == "$PROFILE"
 ${OrIf} $0 == "$WINDIR"
 ${OrIf} $0 == "$PROGRAMFILES"
 ${OrIf} $0 == "$DataRoot"
 ${OrIf} $0 == "$DataRoot\data"
  Abort
 ${EndIf}
 StrLen $1 "$DataRoot\"
 StrCpy $2 "$0\" $1
 StrCmp $2 "$DataRoot\" 0 +2
  Abort
FunctionEnd

Function LegacyDataPage
 IfFileExists "$DataRoot\data\project.json" 0 +2
  Abort
 !insertmacro MUI_HEADER_TEXT "Keep existing projects" "Optional portable data migration"
 nsDialogs::Create 1018
 Pop $0
 ${If} $0 == error
  Abort
 ${EndIf}
 ${NSD_CreateLabel} 0 0 100% 56u "Existing projects in the normal Go Streams user folder are reused automatically.$\r$\n$\r$\nIf your portable edition used its own data folder, select that folder below. The original is kept. Leave empty for a new installation."
 Pop $0
 ${NSD_CreateDirRequest} 0 67u 78% 14u "$LegacyFolder"
 Pop $LegacyInput
 ${NSD_CreateBrowseButton} 81% 66u 19% 16u "Browse..."
 Pop $0
 ${NSD_OnClick} $0 LegacyBrowse
 ${NSD_CreateLabel} 0 100u 100% 40u "Select the folder containing project.json. Close the old Go Streams before opening the Electron edition."
 Pop $0
 nsDialogs::Show
FunctionEnd

Function LegacyBrowse
 nsDialogs::SelectFolderDialog "Select the previous portable data folder" "$LegacyFolder"
 Pop $0
 ${If} $0 != error
  ${NSD_SetText} $LegacyInput "$0"
 ${EndIf}
FunctionEnd

Function LegacyDataLeave
 ${NSD_GetText} $LegacyInput $LegacyFolder
 ${If} $LegacyFolder != ""
  IfFileExists "$LegacyFolder\project.json" accepted
   MessageBox MB_OK|MB_ICONEXCLAMATION "Choose the data folder containing project.json, or leave the field empty."
   Abort
  accepted:
 ${EndIf}
FunctionEnd

Section "Go Streams" Main
 SetShellVarContext current
 SetRegView 64
 ; Never replace a running Electron executable or terminate an active stream.
 IfFileExists "$INSTDIR\GoStreams.exe" 0 check_directory
 ClearErrors
 FileOpen $0 "$INSTDIR\GoStreams.exe" a
 IfErrors running
 FileClose $0
 Goto check_directory
 running:
  MessageBox MB_OK|MB_ICONEXCLAMATION "Close Go Streams before updating, then run setup again. Your projects and sessions have not been removed." /SD IDOK
  SetErrorLevel 2
  Abort
 check_directory:
 ; An existing application directory must carry our own ownership marker.
 IfFileExists "$INSTDIR\.gostreams-electron-install" verify_owner
 FindFirst $0 $1 "$INSTDIR\*.*"
 empty_directory_loop:
  StrCmp $1 "" empty_directory
  StrCmp $1 "." next_directory_entry
  StrCmp $1 ".." next_directory_entry
  FindClose $0
  Goto foreign_directory
 next_directory_entry:
  FindNext $0 $1
  Goto empty_directory_loop
 empty_directory:
 FindClose $0
 Goto install_files
 verify_owner:
 FileOpen $0 "$INSTDIR\.gostreams-electron-install" r
 IfErrors foreign_directory
 FileRead $0 $1
 FileClose $0
 StrCmp $1 "net.antoniofradique.gostreams$\r$\n" install_files
 foreign_directory:
  MessageBox MB_OK|MB_ICONEXCLAMATION "Choose a new empty application folder. Existing files were preserved." /SD IDOK
  SetErrorLevel 2
  Abort
 install_files:
 SetOutPath "$INSTDIR"
 ClearErrors
 File /r "${APPLICATION_DIR}\*"
 IfErrors install_failed
 WriteUninstaller "$INSTDIR\Uninstall Go Streams.exe"
 IfErrors install_failed
 CreateDirectory "$ShortcutDesktop"
 CreateDirectory "$ShortcutMenu"
 CreateShortCut "$ShortcutDesktop\Go Streams.lnk" "$INSTDIR\GoStreams.exe" "" "$INSTDIR\GoStreams.exe" 0
 CreateShortCut "$ShortcutMenu\Go Streams.lnk" "$INSTDIR\GoStreams.exe" "" "$INSTDIR\GoStreams.exe" 0
 WriteRegStr HKCU "${INSTALL_KEY}" "InstallDir" "$INSTDIR"
 WriteRegStr HKCU "${INSTALL_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
 !ifndef TEST_ROOT
  WriteRegStr HKCU "Software\Antonio Fradique\Go Streams" "LegacyPortableRoot" "$EXEDIR"
  ${If} $LegacyFolder != ""
   WriteRegStr HKCU "Software\Antonio Fradique\Go Streams" "LegacyDataDirectory" "$LegacyFolder"
  ${EndIf}
 !endif
 WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Go Streams (Electron)"
 WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
 WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Antonio Fradique"
 WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\GoStreams.exe"
 WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall Go Streams.exe$\"'
 WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall Go Streams.exe$\" /S'
 WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
 WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
 Goto install_complete
 install_failed:
  MessageBox MB_OK|MB_ICONSTOP "Setup could not copy all application files. Run setup again. Your user data was preserved." /SD IDOK
  SetErrorLevel 2
  Abort
 install_complete:
SectionEnd

Function un.onInit
 SetShellVarContext current
 SetRegView 64
 StrCpy $ShortcutDesktop "$DESKTOP"
 StrCpy $ShortcutMenu "$SMPROGRAMS\Go Streams"
 !ifdef TEST_ROOT
  StrCpy $ShortcutDesktop "${TEST_ROOT}\Desktop"
  StrCpy $ShortcutMenu "${TEST_ROOT}\StartMenu\Go Streams"
 !endif
 FileOpen $0 "$INSTDIR\.gostreams-electron-install" r
 IfErrors refuse_uninstall
 FileRead $0 $1
 FileClose $0
 StrCmp $1 "net.antoniofradique.gostreams$\r$\n" valid_uninstall
 refuse_uninstall:
  MessageBox MB_OK|MB_ICONSTOP "The Go Streams installation marker is missing. No files were removed." /SD IDOK
  SetErrorLevel 2
  Abort
 valid_uninstall:
 ; Refuse uninstall while the application is running.
 ClearErrors
 FileOpen $0 "$INSTDIR\GoStreams.exe" a
 IfErrors refuse_running
 FileClose $0
 Return
 refuse_running:
  MessageBox MB_OK|MB_ICONEXCLAMATION "Close Go Streams before uninstalling. Its user data is retained." /SD IDOK
  SetErrorLevel 2
  Abort
FunctionEnd

Section "Uninstall"
 SetShellVarContext current
 SetRegView 64
 ; Generated exact file list: never recursively delete a user-selected folder.
 !include "${OWNED_FILES_INCLUDE}"
 Delete "$INSTDIR\.gostreams-electron-install"
 Delete "$INSTDIR\Uninstall Go Streams.exe"
 Delete "$ShortcutDesktop\Go Streams.lnk"
 Delete "$ShortcutMenu\Go Streams.lnk"
 RMDir "$ShortcutMenu"
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "${INSTALL_KEY}"
 DeleteRegKey HKCU "${UNINSTALL_KEY}"
 ; User data, Electron profiles and legacy Edge/Chrome profiles are untouched.
SectionEnd
