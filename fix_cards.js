const fs = require('fs');
const content = fs.readFileSync('apps/web/index.html', 'utf8');

const regex = /<div id="billingPlanCards"[\s\S]*?<!-- Payment History -->/;

const replacement = `<div id="billingPlanCards" style="display: flex; flex-direction: column; gap: 1.5rem; margin-bottom: 2rem;">
                        <!-- Monthly -->
                        <div class="billing-plan-card" data-plan="monthly_500" style="background: #fff; border-radius: 24px; padding: 2rem 2.5rem; box-shadow: 0 10px 40px rgba(0,0,0,0.04); cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease; border: 1px solid #f3f4f6; display: flex; align-items: center; justify-content: space-between; gap: 2rem; flex-wrap: wrap;">
                            <div style="flex: 1; min-width: 200px;">
                                <div style="display: inline-block; padding: 0.35rem 1rem; background: #f3e8ff; color: #7c3aed; border-radius: 999px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">Monthly</div>
                                <h4 style="font-size: 1.5rem; font-weight: 800; color: #111827; margin: 0 0 0.5rem 0; letter-spacing: -0.02em;">รายเดือน</h4>
                                <div style="display: flex; align-items: baseline; gap: 0.5rem;">
                                    <span style="font-size: 3rem; font-weight: 800; color: #111827; line-height: 1; letter-spacing: -0.03em;">฿299</span>
                                    <div style="display: flex; flex-direction: column; line-height: 1.2;">
                                        <span style="color: #6b7280; font-size: 0.85rem; font-weight: 500;">/ บัญชี</span>
                                        <span style="color: #6b7280; font-size: 0.85rem; font-weight: 500;">ต่อเดือน</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div style="flex: 2; min-width: 280px; padding-left: 2rem; border-left: 2px solid #f3f4f6;">
                                <div style="font-size: 0.95rem; font-weight: 700; color: #374151; margin-bottom: 1rem;">สิ่งที่ท่านจะได้รับ:</div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; color: #4b5563; font-size: 0.95rem; font-weight: 500;">
                                    <div style="display: flex; align-items: center; gap: 0.6rem;"><svg style="width: 20px; height: 20px; color: #8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span><strong style="color: #111827;">โพสต์</strong> ไม่จำกัด</span></div>
                                    <div style="display: flex; align-items: center; gap: 0.6rem;"><svg style="width: 20px; height: 20px; color: #8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span><strong style="color: #111827;">ตั้งเวลา</strong> อัตโนมัติ</span></div>
                                    <div style="display: flex; align-items: center; gap: 0.6rem;"><svg style="width: 20px; height: 20px; color: #8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span><strong style="color: #111827;">จัดการคิว</strong> โพสต์</span></div>
                                    <div style="display: flex; align-items: center; gap: 0.6rem;"><svg style="width: 20px; height: 20px; color: #8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span><strong style="color: #111827;">Auto Hide</strong> Posts</span></div>
                                    <div style="display: flex; align-items: center; gap: 0.6rem;"><svg style="width: 20px; height: 20px; color: #8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>รองรับ <strong style="color: #111827;">หลายเพจ</strong></span></div>
                                </div>
                            </div>

                            <div style="flex: 1; min-width: 150px; display: flex; flex-direction: column; justify-content: center; align-items: flex-end;">
                                <button class="btn-save billing-select-plan-btn" data-plan="monthly_500" style="width: 100%; padding: 1.1rem; border-radius: 999px; font-weight: 700; font-size: 1rem; background: var(--primary); color: #fff; border: none; outline: none; margin-bottom: 0.75rem; cursor: pointer; transition: all 0.2s ease;">
                                    เลือกแพ็กเกจ
                                </button>
                                <div style="color: #9ca3af; font-size: 0.8rem; font-weight: 500; text-align: center; width: 100%;">เริ่มใช้งานได้ทันที</div>
                            </div>
                        </div>

                        <!-- Yearly -->
                        <div class="billing-plan-card" data-plan="yearly_4499" style="background: #fff; border-radius: 24px; padding: 2rem 2.5rem; box-shadow: 0 10px 40px rgba(0,0,0,0.04); cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease; border: 1px solid #f3f4f6; border-left: 6px solid var(--primary); display: flex; align-items: center; justify-content: space-between; gap: 2rem; flex-wrap: wrap; position: relative;">
                            
                            <div style="position: absolute; top: -14px; left: 2.5rem; background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%); color: white; padding: 0.4rem 1.25rem; border-radius: 999px; font-weight: 700; font-size: 0.85rem; box-shadow: 0 6px 12px rgba(124, 58, 237, 0.25);">
                                ✨ ยอดนิยม - ประหยัด ฿589
                            </div>

                            <div style="flex: 1; min-width: 200px; margin-top: 0.5rem;">
                                <div style="display: inline-block; padding: 0.35rem 1rem; background: #f3e8ff; color: #7c3aed; border-radius: 999px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">Yearly</div>
                                <h4 style="font-size: 1.5rem; font-weight: 800; color: #111827; margin: 0 0 0.5rem 0; letter-spacing: -0.02em;">รายปี</h4>
                                <div style="display: flex; align-items: baseline; gap: 0.5rem;">
                                    <span style="font-size: 3rem; font-weight: 800; color: #111827; line-height: 1; letter-spacing: -0.03em;">฿2,999</span>
                                    <div style="display: flex; flex-direction: column; line-height: 1.2;">
                                        <span style="color: #6b7280; font-size: 0.85rem; font-weight: 500;">/ บัญชี</span>
                                        <span style="color: #6b7280; font-size: 0.85rem; font-weight: 500;">ต่อปี</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div style="flex: 2; min-width: 280px; padding-left: 2rem; border-left: 2px solid #f3f4f6; margin-top: 0.5rem;">
                                <div style="font-size: 0.95rem; font-weight: 700; color: #374151; margin-bottom: 1rem;">สิ่งที่ท่านจะได้รับเหมือนรายเดือน และ:</div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; color: #4b5563; font-size: 0.95rem; font-weight: 500;">
                                    <div style="display: flex; align-items: center; gap: 0.6rem;"><svg style="width: 20px; height: 20px; color: #8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span><strong style="color: #111827;">ทุกอย่าง</strong> ใน Monthly</span></div>
                                    <div style="display: flex; align-items: center; gap: 0.6rem;"><svg style="width: 20px; height: 20px; color: #8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>ประหยัด <strong style="color: #111827;">฿589</strong> ต่อปี</span></div>
                                    <div style="display: flex; align-items: center; gap: 0.6rem;"><svg style="width: 20px; height: 20px; color: #8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span><strong style="color: #111827;">Priority</strong> Support</span></div>
                                    <div style="display: flex; align-items: center; gap: 0.6rem;"><svg style="width: 20px; height: 20px; color: #8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span><strong style="color: #111827;">Early Access</strong> ฟีเจอร์ใหม่</span></div>
                                </div>
                            </div>
                            
                            <div style="flex: 1; min-width: 150px; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; margin-top: 0.5rem;">
                                <button class="btn-save billing-select-plan-btn" data-plan="yearly_4499" style="width: 100%; padding: 1.1rem; border-radius: 999px; font-weight: 700; font-size: 1rem; background: var(--primary); color: #fff; border: none; outline: none; margin-bottom: 0.75rem; cursor: pointer; transition: all 0.2s ease;">
                                    เลือกแพ็กเกจ
                                </button>
                                <div style="color: #9ca3af; font-size: 0.8rem; font-weight: 500; text-align: center; width: 100%;">คุ้มสุด แนะนำเลย!</div>
                            </div>
                        </div>
                    </div>

                    <!-- Payment History -->`;

const newContent = content.replace(regex, replacement);
fs.writeFileSync('apps/web/index.html', newContent);
