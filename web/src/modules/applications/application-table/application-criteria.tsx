import { Check, CircleHelp, X } from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge';
import { criterionLabel, type Criterion } from './rows';

const results = {
	met: { icon: Check, label: 'Met', className: 'text-emerald-600' },
	unknown: { icon: CircleHelp, label: 'Unknown', className: 'text-amber-600' },
	failed: { icon: X, label: 'Failed', className: 'text-destructive' },
};

export function ApplicationCriteria({ criteria }: { criteria: Criterion[] }) {
	if (!criteria.length) return <p className="text-sm text-muted-foreground">No criteria were evaluated.</p>;
	return (
		<ul className="space-y-1.5 text-sm">
			{criteria.map((item) => {
				const result = results[item.result];
				return (
					<li key={item.criterion} className="flex items-start gap-2">
						<result.icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${result.className}`} />
						<span className="sr-only">{result.label}:</span>
						<span className="w-36 shrink-0 font-medium first-letter:uppercase">
							{criterionLabel[item.criterion]}
						</span>
						<span className="min-w-0 whitespace-normal text-muted-foreground">{item.detail}</span>
						{item.evidence === 'model' ? (
							<Badge variant="outline" title="Judged by the decision model">
								AI
							</Badge>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
