import { App, Plugin, PluginSettingTab, Setting, Notice, Editor } from "obsidian";

interface LatexConverterSettings {
	ollamaModel: string;
	llmPrompt: string;
	keepAlive: string;
}

const DEFAULT_SETTINGS: LatexConverterSettings = {
	ollamaModel: "llama2",
	llmPrompt:
		'Convert the following natural language to a LaTeX equation, output ONLY THE EQUATION AND NOTHING ELSE: "{input}". Output should be in this format: ${output}$',
	keepAlive: "5m",
};

export default class LatexConverterPlugin extends Plugin {
	settings: LatexConverterSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "convert-to-latex",
			name: "Convert to LaTeX",
			editorCallback: (editor) => this.convertToLatex(editor),
		});

		this.addSettingTab(new LatexConverterSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async convertToLatex(editor: Editor) {
		const selection = editor.getSelection();
		if (!selection) {
			new Notice("No text selected. Please select the text you want to convert to LaTeX.", 5000);
			return;
		}

		const loadingNotice = new Notice("Converting to LaTeX...", 0);

		try {
			const latexEquation = await this.callLocalLLM(selection);
			editor.replaceSelection(`${latexEquation}`);
			new Notice("Successfully converted to LaTeX!", 3000);
		} catch (error) {
			this.handleError(error);
		} finally {
			loadingNotice.hide();
		}
	}

	async callLocalLLM(input: string): Promise<string> {
		const ollamaEndpoint = "http://localhost:11434/api/generate";

		try {
			// Escape double quotes and backslashes in the input to prevent prompt injection
			const sanitizedInput = input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
			const prompt = this.settings.llmPrompt.replace("{input}", sanitizedInput);

			const response = await fetch(ollamaEndpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.settings.ollamaModel,
					prompt: prompt,
					stream: true,
					keep_alive: this.settings.keepAlive,
				}),
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const reader = response.body?.getReader();

			if (!reader) {
				throw new Error("Unable to read response from Ollama");
			}

			let latexEquation = "";
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = new TextDecoder().decode(value);
				const lines = chunk.split("\n").filter((line) => line.trim() !== "");

				for (const line of lines) {
					try {
						const data = JSON.parse(line);
						if (data.response) {
							latexEquation += data.response;
						}
					} catch (parseError) {
						console.error("Error parsing JSON:", parseError);
						throw new Error("Failed to parse response from Ollama");
					}
				}
			}

			return latexEquation.trim();
		} catch (error) {
			console.error("Error in callLocalLLM:", error);
			throw error;
		}
	}

	handleError(error: any) {
		let errorMessage = "An unexpected error occurred while converting to LaTeX.";

		if (error instanceof Error) {
			if (error.message.includes("HTTP error")) {
				errorMessage = `Failed to connect to Ollama. Please ensure Ollama is running and accessible at http://localhost:11434. Error: ${error.message}`;
			} else if (error.message.includes("Failed to parse response")) {
				errorMessage = `Received an invalid response from Ollama. The model might be having issues. Error: ${error.message}`;
			} else if (error.message.includes("Unable to read response")) {
				errorMessage = `Failed to read the response from Ollama. The connection might have been interrupted. Error: ${error.message}`;
			} else {
				errorMessage = `Error converting to LaTeX: ${error.message}`;
			}
		}

		new Notice(errorMessage, 10000);
		console.error(errorMessage);
	}
}

class LatexConverterSettingTab extends PluginSettingTab {
	plugin: LatexConverterPlugin;

	constructor(app: App, plugin: LatexConverterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "LaTeX Generator Settings" });

		new Setting(containerEl)
			.setName("Ollama Model")
			.setDesc("Choose the Ollama model to use for LaTeX conversion")
			.addText((text) =>
				text
					.setPlaceholder("Enter model name")
					.setValue(this.plugin.settings.ollamaModel)
					.onChange(async (value) => {
						this.plugin.settings.ollamaModel = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("LLM Prompt")
			.setDesc(
				"Customize the prompt sent to the LLM. Use {input} as a placeholder for the selected text."
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("Enter custom prompt")
					.setValue(this.plugin.settings.llmPrompt)
					.onChange(async (value) => {
						this.plugin.settings.llmPrompt = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Keep Alive")
			.setDesc(
				'Duration to keep the model loaded in memory. Use "-1" to keep indefinitely, or specify a duration like "5m" for 5 minutes. Default is "5m".'
			)
			.addText((text) =>
				text
					.setPlaceholder("5m")
					.setValue(this.plugin.settings.keepAlive)
					.onChange(async (value) => {
						this.plugin.settings.keepAlive = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
