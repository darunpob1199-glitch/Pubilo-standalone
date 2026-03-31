export type BillingPlanCode = 'test_1' | 'monthly_500' | 'yearly_4499';

export type BillingPlan = {
    code: BillingPlanCode;
    label: string;
    interval: 'monthly' | 'yearly';
    amountThb: number;
    durationDays: number;
    description: string;
};

export const BILLING_PLANS: BillingPlan[] = [
    {
        code: 'test_1',
        label: 'ทดสอบ',
        interval: 'monthly',
        amountThb: 1,
        durationDays: 30,
        description: 'แพ็กเกจทดสอบ 1 บาท 30 วัน',
    },
    {
        code: 'monthly_500',
        label: 'รายเดือน',
        interval: 'monthly',
        amountThb: 500,
        durationDays: 30,
        description: 'แพ็กเกจรายเดือน 30 วัน',
    },
    {
        code: 'yearly_4499',
        label: 'รายปี',
        interval: 'yearly',
        amountThb: 4499,
        durationDays: 365,
        description: 'แพ็กเกจรายปี 365 วัน',
    },
];

export function getBillingPlan(planCode: string | null | undefined): BillingPlan | null {
    return BILLING_PLANS.find((plan) => plan.code === planCode) ?? null;
}
