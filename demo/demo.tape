# betternpm demo — render with: vhs demo/demo.tape
# Produces demo/demo.gif (requires: brew install vhs, and betternpm-cli installed globally)
#
# Beats: (1) npx runs blind → (2) betternpx inspects cowsay and runs it after approval
# → (3) betternpm install blocks a known-vulnerable version (lodash@4.17.15).

Output demo/demo.gif

Set FontSize 15
Set Width 1180
Set Height 640
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 16

Type "# npx runs whatever it downloads. No questions asked."
Enter
Sleep 1.2s

Type "# betternpx inspects first:"
Enter
Type "betternpx cowsay 'inspect before you run'"
Enter
Sleep 9s
Type "y"
Enter
Sleep 4s

Type "clear"
Enter
Sleep 600ms

Type "# and it blocks known-vulnerable versions outright:"
Enter
Type "betternpm install lodash@4.17.15"
Enter
Sleep 9s

Type "# blocked — CVEs shown, nothing executed. betternpm.org"
Enter
Sleep 3s
