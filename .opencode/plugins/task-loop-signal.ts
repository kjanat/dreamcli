import { type Plugin, tool } from "@opencode-ai/plugin"

export const TaskLoopSignal: Plugin = async () => ({
	tool: {
		task_complete: tool({
			description:
				"Signal that the current task is fully complete. Call this ONLY when all work for the task is done and verified.",
			args: {
				summary: tool.schema.string().describe("Brief summary of what was accomplished"),
			},
			async execute(args) {
				return `Task complete: ${args.summary}`
			},
		}),
	},
})
