# Lovelace IDE - VS Code Fork with Claude Integration

This is a fork of Visual Studio Code that integrates Claude AI capabilities directly into the IDE.

## Installation

### Prerequisites
- Node.js (>=20.x)
- npm
- Git

### Building from Source

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-repo/lovelace-ide.git
   cd lovelace-ide
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the application**:
   ```bash
   npm run compile
   ```

### Setting up the `lovelace` CLI Command

#### For Development (Building from Source)

If you built from source, you can set up the `lovelace` command to launch the IDE:

**macOS/Linux**:
1. **Create the launch script**:
   ```bash
   # Replace /path/to/lovelace-ide with your actual project path
   mkdir -p ~/.local/bin
   cat > ~/.local/bin/lovelace << 'EOF'
   #!/bin/bash
   exec "/path/to/lovelace-ide/scripts/code.sh" "$@"
   EOF
   chmod +x ~/.local/bin/lovelace
   ```

2. **Add to PATH** (add to your shell profile: `~/.bashrc`, `~/.zshrc`, etc.):
   ```bash
   export PATH="$HOME/.local/bin:$PATH"
   ```

3. **Reload your shell** and test:
   ```bash
   source ~/.zshrc  # or ~/.bashrc
   lovelace --version
   ```

#### For Production Install (macOS Applications Folder)

If you have the compiled `Lovelace.app` installed in your Applications folder:

1. **Create the CLI script**:
   ```bash
   mkdir -p ~/.local/bin
   cat > ~/.local/bin/lovelace << 'EOF'
   #!/bin/bash
   # Launch Lovelace from Applications folder
   if [ -d "/Applications/Lovelace.app" ]; then
       exec "/Applications/Lovelace.app/Contents/Resources/app/bin/lovelace" "$@"
   else
       echo "Error: Lovelace.app not found in /Applications/"
       echo "Please install Lovelace in your Applications folder first."
       exit 1
   fi
   EOF
   chmod +x ~/.local/bin/lovelace
   ```

2. **Add to PATH** (if not already done):
   ```bash
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```

3. **Test the command**:
   ```bash
   lovelace --version
   ```

**Alternative: Direct symlink approach**:
```bash
# Create a symlink directly to the CLI binary in the app bundle
sudo ln -sf "/Applications/Lovelace.app/Contents/Resources/app/bin/lovelace" /usr/local/bin/lovelace
```

#### Windows

1. **Create a batch file** in a directory that's in your PATH (e.g., `C:\Windows\System32`):
   ```batch
   @echo off
   "C:\path\to\lovelace-ide\scripts\code.bat" %*
   ```
   Save as `lovelace.bat`

### Usage

Once set up, you can use the `lovelace` command just like the regular VS Code `code` command:

```bash
# Open current directory
lovelace .

# Open a specific file
lovelace myfile.js

# Open with specific arguments
lovelace --new-window /path/to/project
```

## Claude Integration Setup

To use the Claude integration features, you need to provide your Anthropic API key. The system will look for the API key in the following order:

### 1. Environment Variable (Recommended)

Set the `ANTHROPIC_API_KEY` environment variable before launching the IDE:

```bash
# On macOS/Linux:
export ANTHROPIC_API_KEY="your-api-key-here"

# On Windows (Command Prompt):
set ANTHROPIC_API_KEY=your-api-key-here

# On Windows (PowerShell):
$env:ANTHROPIC_API_KEY="your-api-key-here"
```

Then launch the IDE normally.

### 2. Browser Local Storage (Web Version)

For the web version, the API key can be stored in the browser's localStorage.

### Getting an API Key

You can obtain an Anthropic API key by:
1. Creating an account at [console.anthropic.com](https://console.anthropic.com)
2. Navigating to API Keys section
3. Creating a new API key

## Claude Agent Features

The Claude integration supports two modes:

### Chat Mode
- General conversation and code assistance
- No file modifications

### Agent Mode  
- Integrated with the Phantom service for safe file operations
- Can analyze, refactor, and modify code
- Supports operations like:
  - Code refactoring and cleanup
  - Renaming symbols across files
  - Extracting functions/components
  - Performance optimization
  - Bug fixes
  - Code migration

File changes in agent mode are handled through the Phantom service, which provides safe, reversible modifications.

## Activity Bar Position

By default, the Activity Bar is now positioned at the **top** of the window. You can change this in settings:
- Go to Settings (Cmd/Ctrl + ,)
- Search for "activity bar location"
- Choose between: Top (default), Left, Bottom, or Hidden

---

# Original VS Code README

[![Feature Requests](https://img.shields.io/github/issues/microsoft/vscode/feature-request.svg)](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
[![Bugs](https://img.shields.io/github/issues/microsoft/vscode/bug.svg)](https://github.com/microsoft/vscode/issues?utf8=✓&q=is%3Aissue+is%3Aopen+label%3Abug)
[![Gitter](https://img.shields.io/badge/chat-on%20gitter-yellow.svg)](https://gitter.im/Microsoft/vscode)

## The Repository

This repository ("`Code - OSS`") is where we (Microsoft) develop the [Visual Studio Code](https://code.visualstudio.com) product together with the community. Not only do we work on code and issues here, we also publish our [roadmap](https://github.com/microsoft/vscode/wiki/Roadmap), [monthly iteration plans](https://github.com/microsoft/vscode/wiki/Iteration-Plans), and our [endgame plans](https://github.com/microsoft/vscode/wiki/Running-the-Endgame). This source code is available to everyone under the standard [MIT license](https://github.com/microsoft/vscode/blob/main/LICENSE.txt).

## Visual Studio Code

<p align="center">
  <img alt="VS Code in action" src="https://user-images.githubusercontent.com/35271042/118224532-3842c400-b438-11eb-923d-a5f66fa6785a.png">
</p>

[Visual Studio Code](https://code.visualstudio.com) is a distribution of the `Code - OSS` repository with Microsoft-specific customizations released under a traditional [Microsoft product license](https://code.visualstudio.com/License/).

[Visual Studio Code](https://code.visualstudio.com) combines the simplicity of a code editor with what developers need for their core edit-build-debug cycle. It provides comprehensive code editing, navigation, and understanding support along with lightweight debugging, a rich extensibility model, and lightweight integration with existing tools.

Visual Studio Code is updated monthly with new features and bug fixes. You can download it for Windows, macOS, and Linux on [Visual Studio Code's website](https://code.visualstudio.com/Download). To get the latest releases every day, install the [Insiders build](https://code.visualstudio.com/insiders).

## Contributing

There are many ways in which you can participate in this project, for example:

* [Submit bugs and feature requests](https://github.com/microsoft/vscode/issues), and help us verify as they are checked in
* Review [source code changes](https://github.com/microsoft/vscode/pulls)
* Review the [documentation](https://github.com/microsoft/vscode-docs) and make pull requests for anything from typos to additional and new content

If you are interested in fixing issues and contributing directly to the code base,
please see the document [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute), which covers the following:

* [How to build and run from source](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
* [The development workflow, including debugging and running tests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#debugging)
* [Coding guidelines](https://github.com/microsoft/vscode/wiki/Coding-Guidelines)
* [Submitting pull requests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#pull-requests)
* [Finding an issue to work on](https://github.com/microsoft/vscode/wiki/How-to-Contribute#where-to-contribute)
* [Contributing to translations](https://aka.ms/vscodeloc)

## Feedback

* Ask a question on [Stack Overflow](https://stackoverflow.com/questions/tagged/vscode)
* [Request a new feature](CONTRIBUTING.md)
* Upvote [popular feature requests](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
* [File an issue](https://github.com/microsoft/vscode/issues)
* Connect with the extension author community on [GitHub Discussions](https://github.com/microsoft/vscode-discussions/discussions) or [Slack](https://aka.ms/vscode-dev-community)
* Follow [@code](https://twitter.com/code) and let us know what you think!

See our [wiki](https://github.com/microsoft/vscode/wiki/Feedback-Channels) for a description of each of these channels and information on some other available community-driven channels.

## Related Projects

Many of the core components and extensions to VS Code live in their own repositories on GitHub. For example, the [node debug adapter](https://github.com/microsoft/vscode-node-debug) and the [mono debug adapter](https://github.com/microsoft/vscode-mono-debug) repositories are separate from each other. For a complete list, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page on our [wiki](https://github.com/microsoft/vscode/wiki).

## Bundled Extensions

VS Code includes a set of built-in extensions located in the [extensions](extensions) folder, including grammars and snippets for many languages. Extensions that provide rich language support (code completion, Go to Definition) for a language have the suffix `language-features`. For example, the `json` extension provides coloring for `JSON` and the `json-language-features` extension provides rich language support for `JSON`.

## Development Container

This repository includes a Visual Studio Code Dev Containers / GitHub Codespaces development container.

* For [Dev Containers](https://aka.ms/vscode-remote/download/containers), use the **Dev Containers: Clone Repository in Container Volume...** command which creates a Docker volume for better disk I/O on macOS and Windows.
  * If you already have VS Code and Docker installed, you can also click [here](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/microsoft/vscode) to get started. This will cause VS Code to automatically install the Dev Containers extension if needed, clone the source code into a container volume, and spin up a dev container for use.

* For Codespaces, install the [GitHub Codespaces](https://marketplace.visualstudio.com/items?itemName=GitHub.codespaces) extension in VS Code, and use the **Codespaces: Create New Codespace** command.

Docker / the Codespace should have at least **4 Cores and 6 GB of RAM (8 GB recommended)** to run full build. See the [development container README](.devcontainer/README.md) for more information.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## License

Copyright (c) Microsoft Corporation. All rights reserved.

Licensed under the [MIT](LICENSE.txt) license.
