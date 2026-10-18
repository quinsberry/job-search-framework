'use client';

import Image from 'next/image';
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
import { RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const items = [
    { icon: chatgptIcon, label: 'ChatGPT', value: 'codex', disabled: false },
    { icon: claudeIcon, label: 'Claude', value: 'claude', disabled: true },
] as const;
export function ActiveAgentSection() {
    const { provider, selectProvider, connection, connecting, connect } = useAgent();
    return (
        <Card>
            <CardHeader>
                <CardTitle>Active Agent</CardTitle>
                <CardDescription>Select the agent you want to use.</CardDescription>
            </CardHeader>
            <CardContent>
                <Field orientation="horizontal">
                    <Select
                        items={items}
                        value={provider}
                        onValueChange={(value) => {
                            if (value) selectProvider(value);
                        }}>
                        <SelectTrigger className="w-full max-w-48">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {items.map((item) => (
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
                    <Button
                        disabled={connecting}
                        variant={connection.available ? 'outline' : 'default'}
                        onClick={() => void connect()}>
                        {connection.available ? <RefreshCw className={cn(connecting && 'animate-spin')} /> : 'Connect'}
                    </Button>
                </Field>
                <FieldDescription role="status">{connection.message}</FieldDescription>
            </CardContent>
        </Card>
    );
}
