# Lovelace IDE

**🚧 Work in Progress - This project is under active development 🚧**

An AI-powered IDE built on open source foundations, featuring deep Claude Code integration for intelligent coding assistance.

## Features

- **Claude AI Integration**: Built-in AI assistant with two modes:
  - **Chat Mode**: General conversation and code assistance
  - **Agent Mode**: Advanced code analysis, refactoring, and automated modifications

- **Phantom Service**: Safe, reversible file operations with:
  - Virtual file system for testing changes
  - Automatic rollback capabilities
  - Preview changes before applying

- **Inline Diff View**: Visual diff display directly in the editor for reviewing AI-suggested changes

- **Smart Code Operations**:
  - Intelligent refactoring across multiple files
  - Symbol renaming with context awareness
  - Function/component extraction
  - Performance optimization suggestions
  - Automated bug fixes
  - Code migration assistance

- **Modern UI/UX**:
  - Activity bar positioned at top (customizable)
  - Lovelace themes (dark/light variants)
  - Streamlined interface for AI interactions

## Installation

**Coming soon** - Installation packages and detailed setup instructions will be available once the project reaches stable release.

## Claude Integration Setup

To use the Claude integration features, you need to have your Anthropic API key available as an environment variable:

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

For persistent configuration, add this to your shell profile (e.g., `~/.profile`, `~/.bashrc`, or `~/.zshrc`).

**Note**: Currently, Lovelace IDE only supports API key authentication. Integration with Claude.ai plans is not yet available as the implementation pathway remains unclear at this stage.

## Contributing

We welcome contributions! Lovelace IDE is an open source project and we're actively seeking contributors to help improve and extend its capabilities.

Ways to contribute:
- Submit bug reports and feature requests
- Improve documentation
- Submit pull requests for bug fixes or new features
- Share feedback and suggestions
- Help test new releases

Please check our GitHub repository for contribution guidelines and open issues.

## Feedback

We'd love to hear from you! Whether it's bug reports, feature requests, or general feedback:
- Open an issue on our [GitHub repository](https://github.com/adacahq/lovelace-ide)
- Join the discussion in our community forums
- Share your experience and suggestions

## License

Licensed under the [MIT](LICENSE.txt) license.