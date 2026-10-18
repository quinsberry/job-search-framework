'use client';

import Image from 'next/image';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Field } from '@/shared/components/ui/field';
import { useState } from 'react';
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

const items = [
    { icon: chatgptIcon, label: 'ChatGPT', value: 'chatgpt', disabled: false },
    { icon: claudeIcon, label: 'Claude', value: 'claude', disabled: true },
] as const;
export function ActiveAgentSection() {
    const [selectedAgent, setSelectedAgent] = useState<(typeof items)[number]['value']>(items[0].value);
    const handleConnectAgent = () => {
        // Implement the logic to connect to the selected agent here
        console.log(`Connecting to agent: ${selectedAgent}`);
    };
    return (
        <Card>
            <CardHeader>
                <CardTitle>Active Agent</CardTitle>
                <CardDescription>Select the agent you want to use.</CardDescription>
            </CardHeader>
            <CardContent>
                <Field orientation="horizontal">
                    <Select items={items} value={selectedAgent} onValueChange={setSelectedAgent}>
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
                    <Button disabled={!selectedAgent} isInProgress={false} onClick={handleConnectAgent}>
                        Connect
                    </Button>
                </Field>
            </CardContent>
        </Card>
    );
}
