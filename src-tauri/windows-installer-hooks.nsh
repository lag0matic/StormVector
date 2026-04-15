!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 desktop_done
    CreateShortCut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  desktop_done:

  !if "${STARTMENUFOLDER}" != ""
    IfFileExists "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" 0 start_done
      CreateShortCut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    start_done:
  !else
    IfFileExists "$SMPROGRAMS\${PRODUCTNAME}.lnk" 0 start_done
      CreateShortCut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    start_done:
  !endif
!macroend
