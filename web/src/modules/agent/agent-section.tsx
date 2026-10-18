'use client';

import Image, { type StaticImageData } from 'next/image';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Field } from '@/shared/components/ui/field';
import { useAgent } from './agent-session';
import { FieldDescription } from '@/shared/components/ui/field';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/shared/components/ui/select';
import chatgptIcon from '@/assets/chatgpt-icon.png';
import claudeIcon from '@/assets/claude-icon.png';
import { Power, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { providerSchema, type Provider } from '@/shared/ai/contracts';

const providers = [
	{ icon: chatgptIcon, label: 'ChatGPT', value: 'codex', disabled: false },
	{ icon: claudeIcon, label: 'Claude', value: 'claude', disabled: true },
] satisfies (
	| { icon: StaticImageData; label: string; value: Provider; disabled: boolean }
	| { icon: StaticImageData; label: string; value: string; disabled: true }
)[];

export function ActiveAgentSection() {
	const { provider, selectProvider, connection, connecting, connect } = useAgent();
	const selectedAgent = providers.find((item) => item.value === provider)!;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Active Agent</CardTitle>
				<CardDescription>Select the agent you want to use.</CardDescription>
			</CardHeader>
			<CardContent>
				<Field orientation="horizontal">
					<Select
						items={providers}
						value={provider}
						onValueChange={(value) => {
							const result = providerSchema.safeParse(value);
							if (result.success) selectProvider(result.data);
						}}
					>
						<SelectTrigger className="w-full max-w-48">
							<SelectValue>
								<Image
									src={selectedAgent.icon}
									alt="Selected Agent"
									width={20}
									height={20}
									className="inline mr-2"
								/>
								{selectedAgent.label}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{providers.map((item) => (
									<SelectItem key={item.value} value={item.value} disabled={item.disabled}>
										{item.icon && (
											<Image
												src={item.icon}
												alt={item.label}
												width={20}
												height={20}
												className="inline mr-2"
											/>
										)}
										{item.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					<Button disabled={connecting} variant="outline" onClick={() => void connect()}>
						{connection.available || connecting ? (
							<RefreshCw className={cn(connecting && 'animate-spin')} />
						) : (
							<Power />
						)}
					</Button>
				</Field>
				<FieldDescription role="status">{connection.message}</FieldDescription>
			</CardContent>
		</Card>
	);
}
