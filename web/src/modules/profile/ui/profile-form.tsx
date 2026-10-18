'use client';
import dynamic from 'next/dynamic';
import { useState, useSyncExternalStore } from 'react';
import { useForm, useWatch, type Control, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/components/ui/collapsible';
import type { ProfileSnapshot } from '../model/contracts';
import { formValidationSchema, fromFormValues, initialFormValues, type FormValues } from '../model/form-model';
import { hasProfileChanges } from '../model/editor-state';
import type { RecoverySession } from '../client/recovery-session';
import type { ProfileFormApi } from '../client/use-profile-session';
import { cn } from '@/shared/lib/utils';

const ProfileFields = dynamic(() => import('./profile-fields'), {
    loading: () => <p role="status">Loading profile fields…</p>,
});

export function useProfileForm(initial: ProfileSnapshot) {
    const [defaults] = useState(() => initialFormValues(initial));
    return useForm<FormValues>({
        defaultValues: defaults,
        resolver: zodResolver(formValidationSchema) as Resolver<FormValues>,
    });
}
export function ProfileForm({
    form,
    session,
    open,
    onOpenChange,
    disabled,
    unpublished,
    busy,
    onSave,
    onDiscard,
}: {
    form: ProfileFormApi;
    session: RecoverySession;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    disabled: boolean;
    unpublished: boolean;
    busy: boolean;
    onSave: () => void;
    onDiscard: () => void;
}) {
    const [visited, setVisited] = useState(false);
    return (
        <Collapsible
            open={open}
            onOpenChange={(value) => {
                onOpenChange(value);
                if (value) setVisited(true);
            }}>
            <CollapsibleTrigger render={<Button variant="outline" />}>
                <ChevronDown data-icon="inline-start" className={cn(open && 'rotate-180', 'transition-all')} />
                Edit candidate profile
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted>
                {visited ? (
                    <form
                        className="flex flex-col gap-5 pt-5"
                        noValidate
                        onSubmit={(event) => {
                            const target = event.currentTarget;
                            void form.handleSubmit(onSave, () => {
                                onOpenChange(true);
                                requestAnimationFrame(() =>
                                    target.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
                                );
                            })(event);
                        }}>
                        <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-5">
                            <ProfileFields control={form.control} />
                            <FormActions
                                control={form.control}
                                session={session}
                                unpublished={unpublished}
                                busy={busy}
                                discard={onDiscard}
                            />
                        </fieldset>
                    </form>
                ) : null}
            </CollapsibleContent>
        </Collapsible>
    );
}
function FormActions({
    control,
    session,
    unpublished,
    busy,
    discard,
}: {
    control: Control<FormValues>;
    session: RecoverySession;
    unpublished: boolean;
    busy: boolean;
    discard: () => void;
}) {
    const values = useWatch({ control }) as FormValues;
    const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
    const changed = unpublished || hasProfileChanges(fromFormValues(values).values, state.baseline);
    return (
        <div className="flex flex-wrap gap-3">
            <Button type="submit" isInProgress={busy} disabled={!changed}>
                Save profile
            </Button>
            <Button type="button" variant="outline" disabled={!changed} onClick={discard}>
                Discard draft
            </Button>
        </div>
    );
}
