(function () {
	const vscode = acquireVsCodeApi();

	let currentSessionId = null;
	let sessions = new Map();

	const messagesContainer = document.getElementById('chatMessages');
	const messageInput = document.getElementById('messageInput');
	const sendButton = document.getElementById('sendButton');
	const terminateButton = document.getElementById('terminateButton');
	const sessionsAccordion = document.getElementById('sessionsAccordion');
	const contextIndicator = document.getElementById('contextIndicator');
	const statusIndicator = document.getElementById('statusIndicator');
	const chatContainer = document.querySelector('.chat-container');
	const modeSelector = document.getElementById('modeSelector');
	const changedFilesContainer = document.getElementById('changedFilesContainer');
	const changedFilesList = document.getElementById('changedFilesList');
	const changeCount = document.getElementById('changeCount');
	const acceptAllBtn = document.getElementById('acceptAllBtn');
	const rejectAllBtn = document.getElementById('rejectAllBtn');

	// Debug check for elements
	console.log('Chat elements check:');
	console.log('messagesContainer:', messagesContainer);
	console.log('messageInput:', messageInput);
	console.log('sendButton:', sendButton);
	console.log('chatContainer:', chatContainer);

	if (!messagesContainer) {
	    console.error('CRITICAL: chatMessages element not found!');
	}

	sendButton.addEventListener('click', sendMessage);
	messageInput.addEventListener('keydown', (e) => {
	    if (e.key === 'Enter' && !e.shiftKey) {
	        e.preventDefault();
	        sendMessage();
	    }
	});


	terminateButton.addEventListener('click', () => {
	    vscode.postMessage({ type: 'terminate' });
	});

	acceptAllBtn?.addEventListener('click', () => {
	    if (currentSessionId) {
	        vscode.postMessage({ type: 'acceptAll', sessionId: currentSessionId });
	    }
	});

	rejectAllBtn?.addEventListener('click', () => {
	    if (currentSessionId) {
	        vscode.postMessage({ type: 'rejectAll', sessionId: currentSessionId });
	    }
	});

	function sendMessage() {
	    const message = messageInput.value.trim();
	    if (!message) return;

	    // Get selected mode
	    const selectedMode = document.querySelector('input[name="mode"]:checked')?.value || 'chat';

	    vscode.postMessage({
	        type: 'sendMessage',
	        message: message,
	        mode: selectedMode
	    });

	    messageInput.value = '';
	    messageInput.focus();
	}

	function renderSessions() {
	    sessionsAccordion.innerHTML = '';

	    sessions.forEach((session, sessionId) => {
	        const tab = document.createElement('div');
	        tab.className = `session-tab ${sessionId === currentSessionId ? 'active' : ''}`;
	        tab.innerHTML = `
	            <span>${session.title}</span>
	            <span class="session-close codicon codicon-close" data-session-id="${sessionId}"></span>
	        `;

	        tab.addEventListener('click', (e) => {
	            if (e.target.classList.contains('session-close')) {
	                e.stopPropagation();
	                vscode.postMessage({
	                    type: 'closeSession',
	                    sessionId: e.target.dataset.sessionId
	                });
	            } else {
	                vscode.postMessage({
	                    type: 'switchSession',
	                    sessionId: sessionId
	                });
	            }
	        });

	        sessionsAccordion.appendChild(tab);
	    });

	    // Add the plus button at the end
	    const plusBtn = document.createElement('button');
	    plusBtn.className = 'new-session-btn';
	    plusBtn.id = 'newSessionBtn';
	    plusBtn.title = 'New Chat';
	    plusBtn.innerHTML = '<i class="codicon codicon-add"></i>';
	    plusBtn.addEventListener('click', () => {
	        vscode.postMessage({ type: 'newSession' });
	    });

	    sessionsAccordion.appendChild(plusBtn);
	}

	function renderMessages(messages) {
	    console.log('renderMessages called with', messages?.length || 0, 'messages');

	    if (!messages || messages.length === 0) {
	        console.log('No messages to render');
	        messagesContainer.innerHTML = '';
	        return;
	    }

	    // Get current message count to determine if we need to add new messages
	    const currentMessageCount = messagesContainer.children.length;
	    const newMessageCount = messages.length;

	    // Count actual messages (not just DOM elements, since assistant messages can have multiple parts)
	    let actualCurrentMessageCount = 0;
	    messages.forEach(msg => {
	        if (msg.role === 'assistant' && msg.parsedMessages && msg.parsedMessages.length > 0) {
	            actualCurrentMessageCount += msg.parsedMessages.length;
	        } else {
	            actualCurrentMessageCount += 1;
	        }
	    });

	    // If we have fewer DOM elements than expected messages, clear and re-render all
	    // Otherwise, only add new messages
	    if (currentMessageCount !== actualCurrentMessageCount) {
	        messagesContainer.innerHTML = '';
	        messages.forEach((msg, index) => {
	            renderSingleMessage(msg, index);
	        });
	    } else {
	        // All messages are already rendered, just update streaming content if needed
	        updateStreamingContent(messages);
	    }

	    messagesContainer.scrollTop = messagesContainer.scrollHeight;
	}

	function renderSingleMessage(msg, index) {
	    console.log(`Rendering message ${index}:`, msg);

	    if (msg.role === 'assistant' && msg.parsedMessages && msg.parsedMessages.length > 0) {
	        // For assistant messages with parsed content, render each parsed message separately
	        msg.parsedMessages.forEach((parsedMsg, parsedIndex) => {
	            const messageDiv = document.createElement('div');
	            messageDiv.className = `message assistant-part${msg.isStreaming ? ' streaming' : ''} just-added`;

	            const headerDiv = document.createElement('div');
	            headerDiv.className = 'message-header';

	            // Remove the just-added class after a short delay to prevent transitions
	            setTimeout(() => messageDiv.classList.remove('just-added'), 50);

	            // Only show header for the first parsed message
	            if (parsedIndex === 0) {
	                headerDiv.innerHTML = `
	                    <i class="codicon codicon-hubot"></i>
	                    <span>Claude</span>
	                    <span>${formatTime(new Date(msg.timestamp))}</span>
	                `;
	            } else {
	                headerDiv.style.display = 'none';
	            }

	            const contentDiv = document.createElement('div');
	            contentDiv.className = 'message-content';

	            // Format the parsed message content
	            const formattedContent = formatParsedMessage(parsedMsg);

	            // Apply progressive text animation for streaming messages
	            // Disable animation for agent mode
	            const currentSession = sessions.get(currentSessionId);
	            const isAgentMode = currentSession && currentSession.mode === 'agent';

	            if (msg.isStreaming && parsedMsg.type === 'text' && !isAgentMode) {
	                animateText(contentDiv, formattedContent, true);
	            } else {
	                contentDiv.innerHTML = formattedContent;
	            }

	            messageDiv.appendChild(headerDiv);
	            messageDiv.appendChild(contentDiv);
	            messagesContainer.appendChild(messageDiv);
	        });
	    } else {
	        // Regular message rendering for user messages and assistant messages without parsed content
	        const messageDiv = document.createElement('div');
	        messageDiv.className = `message ${msg.role}${msg.isStreaming ? ' streaming' : ''} just-added`;

	        // Remove the just-added class after a short delay to prevent transitions
	        setTimeout(() => messageDiv.classList.remove('just-added'), 50);

	        const headerDiv = document.createElement('div');
	        headerDiv.className = 'message-header';

	        const icon = msg.role === 'user' ? 'account' :
	            msg.role === 'assistant' ? 'hubot' :
	                'error';

	        headerDiv.innerHTML = `
	            <i class="codicon codicon-${icon}"></i>
	            <span>${msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Claude' : 'Error'}</span>
	            <span>${formatTime(new Date(msg.timestamp))}</span>
	        `;

	        const contentDiv = document.createElement('div');
	        contentDiv.className = 'message-content';
	        // Format the content based on message type
	        const formattedContent = formatMessage(msg.content || '', msg.role === 'assistant');
	        console.log(`Formatted content for message ${index}:`, formattedContent);

	        // Apply progressive text animation for streaming assistant messages without parsed content
	        // Disable animation for agent mode
	        const currentSession = sessions.get(currentSessionId);
	        const isAgentMode = currentSession && currentSession.mode === 'agent';

	        if (msg.isStreaming && msg.role === 'assistant' && !isAgentMode) {
	            animateText(contentDiv, formattedContent, true);
	        } else {
	            contentDiv.innerHTML = formattedContent;
	        }

	        messageDiv.appendChild(headerDiv);
	        messageDiv.appendChild(contentDiv);
	        messagesContainer.appendChild(messageDiv);
	    }
	}

	function updateStreamingContent(messages) {
	    // Update streaming content for existing messages without re-rendering all
	    messages.forEach((msg, index) => {
	        if (msg.isStreaming) {
	            // Find the corresponding DOM element and update its content
	            const messageElements = messagesContainer.querySelectorAll('.message');
	            // This is a simplified approach - in a real implementation, you'd want to
	            // track message IDs or use a more sophisticated mapping
	            if (messageElements[index]) {
	                const contentDiv = messageElements[index].querySelector('.message-content');
	                if (contentDiv) {
	                    if (msg.role === 'assistant' && msg.parsedMessages && msg.parsedMessages.length > 0) {
	                        // Handle parsed messages
	                        const formattedContent = formatParsedMessage(msg.parsedMessages[msg.parsedMessages.length - 1]);
	                        contentDiv.innerHTML = formattedContent;
	                    } else {
	                        const formattedContent = formatMessage(msg.content || '', msg.role === 'assistant');
	                        contentDiv.innerHTML = formattedContent;
	                    }
	                }
	            }
	        }
	    });
	}

	// Map to track ongoing animations
	const activeAnimations = new Map();

	function animateText(element, htmlContent, isStreaming = false) {
	    // Simply display the content immediately without any animation
	    element.innerHTML = htmlContent;
	    
	    // Scroll to keep new content visible
	    if (messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 100) {
	        messagesContainer.scrollTop = messagesContainer.scrollHeight;
	    }
	}

	function formatParsedMessage(parsedMsg) {
	    // Format individual parsed messages based on their type
	    switch (parsedMsg.type) {
	        case 'text':
	            return formatMessage(filterSystemReminders(parsedMsg.content), true);

	        case 'tool_action':
	            let toolHtml = `<div class="claude-action">⏺ ${escapeHtml(parsedMsg.content)}</div>`;
	            if (parsedMsg.output && parsedMsg.output.length > 0) {
	                toolHtml += '<div class="tool-output-container">';
	                parsedMsg.output.forEach(output => {
	                    toolHtml += `<div class="tool-output">⎿ ${escapeHtml(output)}</div>`;
	                });
	                toolHtml += '</div>';
	            }
	            return toolHtml;

	        case 'code_block':
	            const lang = parsedMsg.language || 'plaintext';
	            if (lang === 'diff') {
	                // Special handling for diff blocks
	                const lines = parsedMsg.content.split('\n').map(line => {
	                    if (line.startsWith('+')) {
	                        return `<span class="diff-add">${escapeHtml(line)}</span>`;
	                    } else if (line.startsWith('-')) {
	                        return `<span class="diff-remove">${escapeHtml(line)}</span>`;
	                    } else {
	                        return escapeHtml(line);
	                    }
	                });
	                return `<pre><code class="language-diff">${lines.join('\n')}</code></pre>`;
	            }
	            return `<pre><code class="language-${lang}">${escapeHtml(parsedMsg.content)}</code></pre>`;

	        case 'status':
	            return `<div class="status-line"><em>${escapeHtml(parsedMsg.content)}</em></div>`;

	        case 'file_operation':
	            if (parsedMsg.fileOperation) {
	                const op = parsedMsg.fileOperation;
	                let html = `<div class="file-operation">📄 <strong>${op.type.charAt(0).toUpperCase() + op.type.slice(1)}: ${escapeHtml(op.filename)}</strong></div>`;

	                if (op.diff) {
	                    html += '<pre><code class="language-diff">';
	                    op.diff.forEach(line => {
	                        const prefix = line.operation === 'add' ? '+' :
	                            line.operation === 'remove' ? '-' : ' ';
	                        html += `<span class="diff-${line.operation}">${escapeHtml(prefix + ' ' + line.content)}</span>\n`;
	                    });
	                    html += '</code></pre>';
	                } else if (op.content) {
	                    const ext = op.filename.split('.').pop();
	                    const lang = getLanguageFromExtension(ext);
	                    html += `<pre><code class="language-${lang}">${escapeHtml(op.content)}</code></pre>`;
	                }

	                return html;
	            }
	            return `<div class="file-operation">${escapeHtml(parsedMsg.content)}</div>`;

	        default:
	            return formatMessage(parsedMsg.content || '', true);
	    }
	}

	function getLanguageFromExtension(ext) {
	    const langMap = {
	        'js': 'javascript',
	        'ts': 'typescript',
	        'jsx': 'javascript',
	        'tsx': 'typescript',
	        'json': 'json',
	        'py': 'python',
	        'java': 'java',
	        'cpp': 'cpp',
	        'c': 'c',
	        'cs': 'csharp',
	        'go': 'go',
	        'rs': 'rust',
	        'html': 'html',
	        'css': 'css',
	        'scss': 'scss',
	        'md': 'markdown',
	        'yml': 'yaml',
	        'yaml': 'yaml',
	        'xml': 'xml',
	        'sh': 'bash',
	        'bash': 'bash',
	        'zsh': 'bash',
	        'ps1': 'powershell',
	        'sql': 'sql'
	    };

	    return langMap[ext] || ext || 'plaintext';
	}

	function formatMessage(content, isAssistant = false) {
	    // Filter out system reminders from all content
	    content = filterSystemReminders(content);

	    if (!isAssistant) {
	        // User messages - simple HTML escaping and formatting
	        content = escapeHtml(content);
	        content = content.replace(/\n/g, '<br>');
	        return content;
	    }

	    // Assistant messages - Claude-style formatting

	    // Handle markdown formatting BEFORE HTML escaping to preserve intended formatting
	    let processed = content;

	    // Format bold text first (before escaping)
	    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

	    // Format italic text (but not status lines we'll handle later)
	    processed = processed.replace(/(?<!^)\*([^*\n]+)\*(?!$)/gm, '<em>$1</em>');

	    // Now escape HTML for security, but preserve our formatting tags
	    processed = escapeHtmlButPreserveTags(processed, ['strong', 'em']);

	    // Handle status lines in italics (our parser wraps them in *)
	    processed = processed.replace(/^\*([^*\n]+)\*$/gm, '<div class="status-line"><em>$1</em></div>');

	    // Format Claude actions (start with ⏺)
	    processed = processed.replace(/^⏺ (.+)$/gm, '<div class="claude-action">⏺ $1</div>');

	    // Format tool output (start with ⎿)
	    processed = processed.replace(/^(\s*)⎿\s*(.+)$/gm, '<div class="tool-output">$1⎿ $2</div>');

	    // Format code blocks - handle both markdown style and indented blocks
	    // We need to preserve newlines in code blocks, so we'll mark them temporarily
	    processed = processed.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
	        const trimmedCode = code.trim();
	        // Special handling for diff blocks
	        if (lang === 'diff') {
	            // Process each line to add appropriate classes
	            const lines = trimmedCode.split('\n').map(line => {
	                if (line.startsWith('+')) {
	                    return `<span class="diff-add">${escapeHtml(line)}</span>`;
	                } else if (line.startsWith('-')) {
	                    return `<span class="diff-remove">${escapeHtml(line)}</span>`;
	                } else {
	                    return escapeHtml(line);
	                }
	            });
	            return `<pre><code class="language-diff">${lines.join('\n')}</code></pre>`;
	        }
	        // Use a placeholder to prevent newline conversion inside code blocks
	        return `<pre><code class="language-${lang || 'plaintext'}">${escapeHtml(trimmedCode)}</code></pre>`;
	    });

	    // Format inline code
	    processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>');

	    // Convert newlines to breaks, but NOT inside <pre><code> blocks
	    // First, extract and preserve code blocks
	    const codeBlocks = [];
	    let codeBlockIndex = 0;

	    // Replace code blocks with placeholders
	    processed = processed.replace(/<pre><code[^>]*>[\s\S]*?<\/code><\/pre>/g, (match) => {
	        const placeholder = `__CODE_BLOCK_${codeBlockIndex}__`;
	        codeBlocks[codeBlockIndex] = match;
	        codeBlockIndex++;
	        return placeholder;
	    });

	    // Now convert newlines to <br> in the rest of the content
	    processed = processed.replace(/\n/g, '<br>');

	    // Restore code blocks with original newlines
	    codeBlocks.forEach((block, index) => {
	        processed = processed.replace(`__CODE_BLOCK_${index}__`, block);
	    });

	    return processed;
	}

	function escapeHtml(text) {
	    const div = document.createElement('div');
	    div.textContent = text;
	    return div.innerHTML;
	}

	function escapeHtmlButPreserveTags(text, allowedTags) {
	    // First, temporarily replace allowed tags with placeholders
	    const tagPlaceholders = {};
	    let placeholderIndex = 0;

	    allowedTags.forEach(tag => {
	        // Handle opening tags
	        const openRegex = new RegExp(`<${tag}>`, 'g');
	        text = text.replace(openRegex, () => {
	            const placeholder = `__TAG_PLACEHOLDER_${placeholderIndex}__`;
	            tagPlaceholders[placeholder] = `<${tag}>`;
	            placeholderIndex++;
	            return placeholder;
	        });

	        // Handle closing tags
	        const closeRegex = new RegExp(`</${tag}>`, 'g');
	        text = text.replace(closeRegex, () => {
	            const placeholder = `__TAG_PLACEHOLDER_${placeholderIndex}__`;
	            tagPlaceholders[placeholder] = `</${tag}>`;
	            placeholderIndex++;
	            return placeholder;
	        });
	    });

	    // Escape the HTML
	    text = escapeHtml(text);

	    // Restore the allowed tags
	    Object.keys(tagPlaceholders).forEach(placeholder => {
	        text = text.replace(placeholder, tagPlaceholders[placeholder]);
	    });

	    return text;
	}

	function formatTime(date) {
	    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function filterSystemReminders(text) {
	    // Remove system-reminder blocks using regex
	    const systemReminderRegex = /<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/gi;
	    return text.replace(systemReminderRegex, '').trim();
	}

	window.addEventListener('message', event => {
	    const message = event.data;

	    // Debug logging
	    console.log('Received message:', message);

	    switch (message.type) {
	        case 'update':
	            console.log('Processing update message');
	            console.log('Sessions:', message.sessions);
	            console.log('Current session ID:', message.currentSessionId);
	            console.log('Current session:', message.currentSession);

	            sessions.clear();
	            message.sessions.forEach(session => {
	                sessions.set(session.id, session);
	            });
	            currentSessionId = message.currentSessionId;

	            renderSessions();

	            if (message.currentSession) {
	                console.log('Rendering messages:', message.currentSession.messages);
	                renderMessages(message.currentSession.messages);

	                // Update mode selector based on session state
	                if (message.currentSession.mode) {
	                    // Set the mode radio button
	                    const modeRadio = document.querySelector(`input[name="mode"][value="${message.currentSession.mode}"]`);
	                    if (modeRadio) {
	                        modeRadio.checked = true;
	                    }
	                }

	                // Disable mode selector if session has messages (mode is locked after first message)
	                if (message.currentSession.messages && message.currentSession.messages.length > 0) {
	                    const modeRadios = document.querySelectorAll('input[name="mode"]');
	                    modeRadios.forEach(radio => {
	                        radio.disabled = true;
	                    });
	                } else {
	                    // Enable mode selector for new sessions
	                    const modeRadios = document.querySelectorAll('input[name="mode"]');
	                    modeRadios.forEach(radio => {
	                        radio.disabled = false;
	                    });
	                }

	                // Show/hide terminate button based on streaming state
	                if (message.currentSession.isStreaming) {
	                    terminateButton.style.display = 'block';
	                    sendButton.style.display = 'none';
	                } else {
	                    terminateButton.style.display = 'none';
	                    sendButton.style.display = 'block';
	                }
	            } else {
	                console.log('No current session to render!');
	                // Enable mode selector for no session
	                const modeRadios = document.querySelectorAll('input[name="mode"]');
	                modeRadios.forEach(radio => {
	                    radio.disabled = false;
	                });
	            }
	            break;

	        case 'selectionUpdate':
	            if (message.selection) {
	                contextIndicator.textContent = `Selected: ${message.fileName}`;
	                contextIndicator.classList.add('visible');
	            } else {
	                contextIndicator.classList.remove('visible');
	            }
	            break;

	        case 'changesUpdate':
	            updateChangedFiles(message.sessionId, message.changes);
	            break;

	        case 'streamingUpdate':
	            // Update the last assistant message with streaming content
	            const lastMessageDiv = messagesContainer.lastElementChild;
	            if (lastMessageDiv && lastMessageDiv.querySelector('.message-header').textContent.includes('Claude')) {
	                const contentDiv = lastMessageDiv.querySelector('.message-content');
	                if (contentDiv) {
	                    // Format the streaming content with markdown support
	                    contentDiv.innerHTML = formatMessage(message.content, true);
	                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
	                }
	            }

	            // Update status indicator if present
	            if (message.status) {
	                statusIndicator.innerHTML = `<em>${escapeHtml(message.status)}</em>`;
	                statusIndicator.style.display = 'block';
	            }
	            break;


	        case 'statusUpdate':
	            if (message.status) {
	                statusIndicator.innerHTML = `<em>${escapeHtml(message.status)}</em>`;
	                statusIndicator.style.display = 'block';
	            }
	            break;

	        case 'clearStatus':
	            statusIndicator.style.display = 'none';
	            statusIndicator.innerHTML = '';
	            break;

	    }
	});

	function updateChangedFiles(sessionId, changes) {
	    if (sessionId !== currentSessionId) return;

	    if (!changes || (!changes.modified?.length && !changes.added?.length && !changes.deleted?.length)) {
	        // No changes, hide the container
	        changedFilesContainer.style.display = 'none';
	        return;
	    }

	    // Show the container
	    changedFilesContainer.style.display = 'block';

	    // Update change count
	    const totalChanges = (changes.modified?.length || 0) + (changes.added?.length || 0) + (changes.deleted?.length || 0);
	    changeCount.textContent = totalChanges.toString();

	    // Clear existing list
	    changedFilesList.innerHTML = '';

	    // Add modified files
	    changes.modified?.forEach(file => {
	        const item = createFileItem(file, 'modified');
	        changedFilesList.appendChild(item);
	    });

	    // Add added files
	    changes.added?.forEach(file => {
	        const item = createFileItem(file, 'added');
	        changedFilesList.appendChild(item);
	    });

	    // Add deleted files
	    changes.deleted?.forEach(file => {
	        const item = createFileItem(file, 'deleted');
	        changedFilesList.appendChild(item);
	    });
	}

	function createFileItem(file, type) {
	    const item = document.createElement('div');
	    item.className = 'changed-file-item';
	    item.setAttribute('data-file-path', file.path);
	    item.setAttribute('data-file-type', type);

	    const fileInfo = document.createElement('div');
	    fileInfo.className = 'file-info';

	    const icon = document.createElement('i');
	    icon.className = `codicon file-icon ${type}`;
	    switch (type) {
	        case 'modified':
	            icon.classList.add('codicon-diff-modified');
	            break;
	        case 'added':
	            icon.classList.add('codicon-diff-added');
	            break;
	        case 'deleted':
	            icon.classList.add('codicon-diff-removed');
	            break;
	    }

	    const filePath = document.createElement('span');
	    filePath.className = 'file-path';
	    filePath.textContent = file.path;

	    fileInfo.appendChild(icon);
	    fileInfo.appendChild(filePath);

	    // Add stats for modified files
	    if (type === 'modified' && (file.additions !== undefined || file.deletions !== undefined)) {
	        const stats = document.createElement('div');
	        stats.className = 'file-stats';

	        if (file.additions > 0) {
	            const additions = document.createElement('span');
	            additions.className = 'stat-addition';
	            additions.textContent = `+${file.additions}`;
	            stats.appendChild(additions);
	        }

	        if (file.deletions > 0) {
	            const deletions = document.createElement('span');
	            deletions.className = 'stat-deletion';
	            deletions.textContent = `-${file.deletions}`;
	            stats.appendChild(deletions);
	        }

	        item.appendChild(fileInfo);
	        item.appendChild(stats);
	    } else if (type === 'added' && file.lines !== undefined) {
	        const stats = document.createElement('div');
	        stats.className = 'file-stats';
	        const additions = document.createElement('span');
	        additions.className = 'stat-addition';
	        additions.textContent = `+${file.lines}`;
	        stats.appendChild(additions);
	        item.appendChild(fileInfo);
	        item.appendChild(stats);
	    } else {
	        item.appendChild(fileInfo);
	    }

	    // Click handler to open diff
	    item.addEventListener('click', () => {
	        vscode.postMessage({
	            type: 'openDiff',
	            sessionId: currentSessionId,
	            filePath: file.path
	        });
	    });

	    return item;
	}

	messageInput.focus();
})();
