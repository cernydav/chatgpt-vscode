import * as vscode from 'vscode';
import * as https from 'https';
import * as openAI from 'openai';



type AuthInfo = {apiToken?: string};



  

export function activate(context: vscode.ExtensionContext) {
	// Get the API session token from the extension's configuration
	const config = vscode.workspace.getConfiguration('gptcode');

	// Create a new codegptiewProvider instance and register it with the extension's context
	const provider = new GptcodeViewProvider(context.extensionUri);

	// Put configuration settings into the provider
	
	provider.setAuthenticationInfo({
		apiToken: config.get('apiToken')
	});
	provider.selectedInsideCodeblock = config.get('selectedInsideCodeblock') || false;
	provider.pasteOnClick = config.get('pasteOnClick') || false;
	provider.keepConversation = config.get('keepConversation') || false;
	provider.timeoutLength = config.get('timeoutLength') || 60;

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(GptcodeViewProvider.viewType, provider,  {
			webviewOptions: { retainContextWhenHidden: true }
		})
	); 


	const commandHandler = (command:string) => {
		const config = vscode.workspace.getConfiguration('gptcode');
		const prompt = config.get(command) as string;
		provider.search(prompt);
	};
	
	// Register the commands that can be called from the extension's package.json
	const commandAsk = vscode.commands.registerCommand('gptcode.ask', () => {
		vscode.window.showInputBox({ prompt: 'What do you want to do?' }).then((value) => {
			provider.search(value);
		});
	});
	/*
	const commandConversationId = vscode.commands.registerCommand('gptcode.conversationId', () => {
		vscode.window.showInputBox({ 
			prompt: 'Set Conversation ID or delete it to reset the conversation',
			placeHolder: 'conversationId (leave empty to reset)',
			value: provider.getConversationId()
		}).then((conversationId) => {
			if (!conversationId) {
				provider.setConversationId();
			} else {
				vscode.window.showInputBox({ 
					prompt: 'Set Parent Message ID',
					placeHolder: 'messageId (leave empty to reset)',
					value: provider.getParentMessageId()
				}).then((messageId) => {
					provider.setConversationId(conversationId, messageId);
				});
			}
		});
	}); */

	const commandReplaceSelectedDescription = vscode.commands.registerCommand('gptcode.replaceSelectedDescription', () => {	
		commandHandler('promptPrefix.replaceSelectedDescription');
	});

	const commandWriteTest = vscode.commands.registerCommand('gptcode.writeTest', () => {	
		commandHandler('promptPrefix.writeTest');
	});


	const commandExplain = vscode.commands.registerCommand('gptcode.explain', () => {	
		commandHandler('promptPrefix.explain');
	});
	const commandRefactor = vscode.commands.registerCommand('gptcode.refactor', () => {
		commandHandler('promptPrefix.refactor');
	});
	const commandOptimize = vscode.commands.registerCommand('gptcode.optimize', () => {
		commandHandler('promptPrefix.optimize');
	});
	const commandProblems = vscode.commands.registerCommand('gptcode.findProblems', () => {
		commandHandler('promptPrefix.findProblems');
	});
	let commandResetConversation = vscode.commands.registerCommand('gptcode.resetConversation', () => {
		provider.resetConversation();
	});
	context.subscriptions.push(commandAsk, commandExplain, commandRefactor, commandOptimize, commandProblems, commandReplaceSelectedDescription, commandWriteTest, commandResetConversation);


	// Change the extension's session token when configuration is changed
	vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
		if (event.affectsConfiguration('gptcode.apiToken')) {
			// Get the extension's configuration
			const config = vscode.workspace.getConfiguration('gptcode');
			// add the new token to the provider
			provider.setAuthenticationInfo({apiToken: config.get('apiToken')});

		} else if (event.affectsConfiguration('gptcode.selectedInsideCodeblock')) {
			const config = vscode.workspace.getConfiguration('gptcode');
			provider.selectedInsideCodeblock = config.get('selectedInsideCodeblock') || false;

		} else if (event.affectsConfiguration('gptcode.pasteOnClick')) {
			const config = vscode.workspace.getConfiguration('gptcode');
			provider.pasteOnClick = config.get('pasteOnClick') || false;

		} else if (event.affectsConfiguration('gptcode.keepConversation')) {
			const config = vscode.workspace.getConfiguration('gptcode');
			provider.keepConversation = config.get('keepConversation') || false;

		} else if (event.affectsConfiguration('gptcode.timeoutLength')) {
			const config = vscode.workspace.getConfiguration('gptcode');
			provider.timeoutLength = config.get('timeoutLength') || 60;
		}
});
}










class GptcodeViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'gptcode.chatView';
	private _view?: vscode.WebviewView;

	private _response?: string;
	private _prompt?: string;
	private _fullPrompt?: string;
	//private _currentMessageNumber = 0;

	public selectedInsideCodeblock = true;
	public pasteOnClick = true;
	public keepConversation = true;
	public timeoutLength = 60;
	private _authInfo?: AuthInfo;

	private config: any;
	private openai: any;



	// In the constructor, we store the URI of the extension
	constructor(private readonly _extensionUri: vscode.Uri) {


	  this.config = vscode.workspace.getConfiguration('gptcode');
	  this.openai = this.generateOpenAI(this.config);

	}
	
	// Set the session token and create a new API instance based on this token
	public setAuthenticationInfo(authInfo: AuthInfo) {
		this._authInfo = authInfo;
//		this._newAPI();

	}



	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		// set options for the webview
		this._view.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		// set the HTML for the webview
		this._view.webview.html = this._getHtmlForWebview(webviewView.webview);

		// add an event listener for messages received by the webview
		this._view.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'codeSelected':
					{
						// do nothing if the pasteOnClick option is disabled
						if (!this.pasteOnClick) {
							break;
						}

						let code = data.value;
						code = code.replace(/([^\\])(\$)([^{0-9])/g, "$1\\$$$3");

						// insert the code as a snippet into the active text editor
						vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(code));
						break;
					}
				case 'prompt':
					{
						this.search(data.value);
					}
			}
		});
	}


	public async resetConversation() {
		//this.setConversationId();
		this._prompt = '';
		this._response = '';
		this._fullPrompt = '';
		this._view?.webview.postMessage({ type: 'setPrompt', value: '' });
		this._view?.webview.postMessage({ type: 'addResponse', value: '' });
	}

	////////////////////	////////////////////	////////////////////



  

	private validate(): boolean {


		
	  if (!this.config.apiKey) {
		vscode.window.showErrorMessage("No Open AI key provided in settings.")
		return false;
	  }
	  return true;
	}
  
	private generateOpenAI(config: any): any {
	  const configuration = new openAI.Configuration({
		apiKey: config.apiKey,
	  });
	  return new openAI.OpenAIApi(configuration);
	}
  
	private generateResponse(input: string, disposableStatusMessage: any) {
	  this.openai.createCompletion({
		model: "text-davinci-003",
		prompt: input,
		temperature: 0.7,
		max_tokens: 256,
		top_p: 1,
		frequency_penalty: 0,
		presence_penalty: 0,
	  }).then((response : any) => {
		this.displayResult(response);
		disposableStatusMessage.dispose();

		
	  }).catch((error : any) => {
		vscode.window.showErrorMessage(error.response.data.error.message);
		disposableStatusMessage.dispose();
	  });
	}
  
	private displayResult(openAIResponse: any) {
	  //let panel = vscode.window.createWebviewPanel('webview', 
		//											'AI Result', 
	//												{ preserveFocus: true, viewColumn: vscode.ViewColumn.One});
	  
		
													
												//	var md = require('markdown-it')();

	let data = openAIResponse.data.choices[0].text;

	  //const result = md.render('```\n'  + ( data|| "Nothing found") + '\n```' );
	  //panel.webview.html = result;



	  
		
	  this._response = data;
	 // console.log(data);
	  // Show the view and send a message to the webview with the response
	  if (this._view) {
		  this._view.show?.(true);

		  
		  this._view.webview.postMessage({ type: 'addResponse', value: data });
	  }


	}


	////////////////////














	public async search(prompt?:string) {
		this._prompt = prompt;
		if (!prompt) {
			prompt = '';
		};


		if (!this._view) {
			await vscode.commands.executeCommand('codegpt.chatView.focus');
		} else {
			this._view?.show?.(true);
		}
		
		let response = '';
		this._response = '';
		// Get the selected text of the active editor
		const selection = vscode.window.activeTextEditor?.selection;
		const selectedText = vscode.window.activeTextEditor?.document.getText(selection);
		let searchPrompt = '';

		if (selection && selectedText) {
			// If there is a selection, add the prompt and the selected text to the search prompt
			if (this.selectedInsideCodeblock) {
				searchPrompt = `${prompt}\n\`\`\`\n${selectedText}\n\`\`\``;
			} else {
				searchPrompt = `${prompt}\n${selectedText}\n`;
			}
		} else {
			// Otherwise, just use the prompt if user typed it
			searchPrompt = prompt;
		}
		this._fullPrompt = searchPrompt;


			//console.log("sendMessage");
			
			// Make sure the prompt is shown
			this._view?.webview.postMessage({ type: 'setPrompt', value: this._prompt });
			this._view?.webview.postMessage({ type: 'addResponse', value: '...' });

			// Increment the message number
			//this._currentMessageNumber++;



		//	try {



				const apiKey = vscode.workspace.getConfiguration('gptcode').apiKey;
			
				if (!apiKey) {
				vscode.window.showErrorMessage('Please provide a valid API key in the entension configuration.');
				return;
				}
			

				if (!this.validate()) {
					return;
				  }
			  
				  if (searchPrompt) {
					let disposableStatusMessage = vscode.window.setStatusBarMessage("Loading result...");
					this.generateResponse(searchPrompt, disposableStatusMessage);
				  }
				

				/*
				const configs = vscode.workspace.getConfiguration('gptcode').get('parameters');
			
				const denulledConfigs: { [key: string]: any } = {};
			
				Object.entries(configs as  { [key: string]: any }).forEach((entry) => {
				if (entry[1] !== null) {
					denulledConfigs[entry[0]] = entry[1];
				}
				});
			
				const data = JSON.stringify({ ...denulledConfigs, prompt: searchPrompt });
			
				const options: https.RequestOptions = {
				hostname: 'api.openai.com',
				path: '/v1/completions',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
				},
				};
			
				const req = https.request(options, (res) => {
				let responseRaw = '';
				res.on('data', (d) => {
					responseRaw = d;
				});
				res.on('end', () => {
					const parsedJson = JSON.parse(responseRaw);

					//const editor = vscode.window.activeTextEditor;
					const choices = parsedJson.choices.map((choice: { text: any; }) => choice.text);
			
					const parsedRes = choices.join("\n");

					//editor.edit((editBuilder) => {
				//		editBuilder.insert(editor.selection.end, '\n' + choices);
			//		});

					//console.log(responseRaw);

					if (parsedRes.error) {
					vscode.window.showErrorMessage(
						`${parsedRes.error.message} Type:${parsedRes.error.type} Param:${parsedRes.error.param} Code:${parsedRes.error.code}`,
					);
					return;
					}


					this._response = parsedRes;
					console.log(parsedRes);
					// Show the view and send a message to the webview with the response
					if (this._view) {
						this._view.show?.(true);
						this._view.webview.postMessage({ type: 'addResponse', value: parsedRes });
					}

	
					});
				});
			
				req.on('error', (error) => {
				console.error(error);
				});
			
				req.write(data);
				req.end();
  




			} catch (e) {
				console.error(e);
				response += `\n\n---\n[ERROR] ${e}`;
			}*/
		//}

		// Saves the response
	
	}

	private _getHtmlForWebview(webview: vscode.Webview) {

		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
		const microlightUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'scripts', 'microlight.min.js'));
		const tailwindUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'scripts', 'showdown.min.js'));
		const showdownUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'scripts', 'tailwind.min.js'));

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<script src="${tailwindUri}"></script>
				<script src="${showdownUri}"></script>
				<script src="${microlightUri}"></script>
				<style>
				.code {
					white-space: pre;
				}
				p {
					padding-top: 0.25rem;
					padding-bottom: 0.25rem;
				}		
				</style>
			</head>
			<body>
				<input class="h-10 w-full text-white bg-stone-700 p-4 text-sm" placeholder="Ask gptcode something" id="prompt-input" />

				
				<div id="response" class="pt-4 text-sm" >
				
				</div>

				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}