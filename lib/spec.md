This utility is used to extract files from packages to an output dir.

The extraction of a package is the process of looking at config, finding filesets and then exporting the actual files for the specific fileset.

The cli tools should only have logic related to UI: arguments processing, console logging and error handling for the user. All logic should be in package or fileset libs.

>> Pseudo algorithm for the extraction is as follows:

Divide into two steps:
1. build a diff with the extraction map according to configs and output dir state (files to be added, removed, conflicts etc). Doing this step without any writable actions makes this steps able to be reused by different actions.
2. execute the expected action (write/delete files to disk if not dryRun, check if files are in sync ok, purge actual files). The removal of files has to be done at the end after all sets are processed because the same package might contain different set of files that will be combined in the resulting output.

For step 1:
1. cli extract --[selector arguments] --[output arguments]
2. extractPackage(packageName, version, selector config, output config)
3. load self config
4. if no configuration found:
4.1. call extractFileset(packageName, version, selector, output configs)
5. else, for each fileset in config:
5.1. merge current selector/output config with fileset config (this will be used as the new selector/output config for calls below)
5.2. if package == current:
5.2.1. call extractFileset(packageName, version, selector, output configs)
5.3. else
5.3.1. call extractPackage(packageName, version, selector, output config) - recursion point, making selector and config inherited to lower packages

About merge process (5.1):
- Merge files pattern and content regex with AND (should have both matches)
- Merge output config (managed, gitignore etc) by making the higher dependency (the one more near the user call) override lower (packages that current package his depends on)
- "Presets" are not inherited as they are used only by one level to select the sets for the package
- symlinks and contentReplacements should be appended
- output path should be concatenated, not overriden, such as [path from cli]/[path from package 1]/[path from package 2]


This is an example of the different npm packages that might be involved in common scenarios:

>> package: security-rules (data)
/security/rules.md
> no config, only files in package

>> package: devops-rules (data)
/devops/rules.md
/security/script.sh
> no config, only files in package

>> package: myorg-kit (combines other packages, and also adds some data itself)
/myorg/welcome.md
> config in package.json/.npmdatarc, indicates sets, sources, selector, output, presets definition
> sets:
   - package: myorg-kit; files: myorg/**; presets: basic,extended
   - package: devops-rules; files: devops/**; presets: basic,extended
   - package: security-rules; files: security/**; presets: extended

>> npmdata cli (used to extract myorg-kit files to an output dir)
> config in package.json or .npmdatarc with sets:
   - package: myorg-kit; selector: basic, files: *.md

So, npmdata cli ----> myorg-kit ---> devops-rules
                               `--> security-rules

What should happen in this example:
- The cli is invoked with action "extract"
- It tries to find npmdata config in .npmdatarc in current dir where it was executed
- It will invoke package extraction of myorg-kit, also sending the constraint that it wants only the preset "basic", and with the force: true option (to override any files during extraction)
- During the package extraction of myorg-kit, it will extract its own files (that are part of the "basic" preset, and that matches *.md), and also start the extraction of package devops-rules, sending the constraint that it wants files devops/** AND *.md from this package, but won't send the "basic" preset, as presets are not inherited
- During extraction of package devops-rules, it won't detect any config with sets, so it will simply try to export it's files, obeying the constraints that came from the previous step (devops/**)
- The final output dir should have ONLY the files 
  /devops/rules.md
  /myorg/welcome.md


Other usage examples:
npx npmdata --packages myorg-kit
   has the same effect as
npx myorg-kit
   has the same effect as
npx npmdata (with config file with a set with package: myorg-kit)

npx npmdata --packages myorg-kit --presets basic
   has the same effect as
npx myorg-kit --presets basic
