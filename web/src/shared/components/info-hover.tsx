import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { InfoIcon } from 'lucide-react';

export function InfoTooltip({ children }: { children: React.ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button variant="ghost" size="icon-sm">
						<InfoIcon />
					</Button>
				}
			/>
			<TooltipContent>{children}</TooltipContent>
		</Tooltip>
	);
}
