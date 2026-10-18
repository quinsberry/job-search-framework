import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
export function FieldSection({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}
