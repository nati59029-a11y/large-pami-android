set -e
J=android/app/src/main/java/com/largepami/finance
rm -f $J/SaveFilePlugin.java
cat > $J/MainActivity.java <<'JAVA'
package com.largepami.finance;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
JAVA
