; The bundled installer runs elevated. Only the bundled receiver is allowed
; inbound traffic, and only from the local subnet on Private networks.
!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\_internal\bin\uxplay.exe" +2 0
    Goto uxnow_firewall_missing
  nsExec::ExecToStack '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="UxNow AirPlay (Private)" dir=in profile=private program="$INSTDIR\_internal\bin\uxplay.exe"'
  Pop $0
  Pop $1
  nsExec::ExecToStack '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="UxNow AirPlay (Private)" dir=in action=allow program="$INSTDIR\_internal\bin\uxplay.exe" enable=yes profile=private remoteip=localsubnet'
  Pop $0
  Pop $1
  StrCmp $0 "0" uxnow_firewall_done
  MessageBox MB_OK|MB_ICONEXCLAMATION "UxNow se instaló, pero Windows no permitió crear la regla de AirPlay. Revisa el diagnóstico del firewall en Ajustes."
  Goto uxnow_firewall_done
uxnow_firewall_missing:
  MessageBox MB_OK|MB_ICONEXCLAMATION "UxNow no encontró el uxPlay incluido. Reinstala la aplicación."
uxnow_firewall_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToStack '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="UxNow AirPlay (Private)" dir=in profile=private program="$INSTDIR\_internal\bin\uxplay.exe"'
  Pop $0
  Pop $1
!macroend
