app.post('/api/ai/toolkit', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
    const { tool, topic } = req.body;

    if (!apiKey) throw new Error("API Key required.");

    let systemPrompt = `You are an expert UK education professional and Senior Leader. Format output in clean HTML divs using headings, bullet points, and tables where appropriate.`;
    
    // --- Classroom Teacher Tools ---
    if (tool === 'song') systemPrompt += ` Write a catchy educational song summarizing the topic to the tune of a well-known pop song.`;
    else if (tool === 'comprehension') systemPrompt += ` Generate a reading passage on the topic, followed by 3 differentiated question sets (Basic, Secure, Advanced).`;
    else if (tool === 'explainer') systemPrompt += ` Explain the concept as if I am 11 years old, using a highly relatable everyday analogy.`;
    else if (tool === 'spag') systemPrompt += ` Write a paragraph related to the topic containing 10 deliberate SPaG errors for students to correct. Provide the answer key below.`;
    else if (tool === 'quiz') systemPrompt += ` Generate a 10-question multiple choice quiz on this topic with an answer key at the bottom.`;
    else if (tool === 'markscheme') systemPrompt += ` Generate a detailed mark scheme or grading rubric for a student assignment on this topic.`;
    else if (tool === 'sow') systemPrompt += ` Generate a 6-week Scheme of Work (SoW) overview for this topic. Include weekly learning objectives and key activities.`;
    else if (tool === 'reports') systemPrompt += ` Write 3 differentiated report card comment templates (Exceeding, Expected, Emerging) regarding student performance in this topic.`;
    
    // --- SEN & Inclusion Tools ---
    else if (tool === 'iep') systemPrompt += ` Draft an Individual Education Plan (IEP) strategies list for a student struggling with this specific topic/concept.`;
    else if (tool === 'dyslexia_adapt') systemPrompt += ` Rewrite the provided text/concept to be highly accessible for a student with Dyslexia, using bullet points and simplified vocabulary.`;

    // --- SLT & Admin Tools ---
    else if (tool === 'policy') systemPrompt += ` Write a formal, comprehensive UK school policy document regarding this topic. Include intent, scope, and procedures.`;
    else if (tool === 'newsletter') systemPrompt += ` Write a warm, professional, engaging parent/carer newsletter segment about this topic.`;
    else if (tool === 'observation') systemPrompt += ` Write constructive, professional, formal lesson observation feedback based on these notes. Detail strengths and clear areas for development.`;
    else if (tool === 'sip') systemPrompt += ` Draft a School Improvement Plan (SIP) objective section addressing this target. Include success criteria, monitoring strategies, and intended impact.`;
    else if (tool === 'governor') systemPrompt += ` Write a formal, data-driven report section intended for the Board of Governors summarizing this topic/issue.`;
    else if (tool === 'cpd') systemPrompt += ` Design a 1-hour staff CPD (Continuing Professional Development) session plan on this topic. Include timings, activities, and resources needed.`;
    else if (tool === 'risk') systemPrompt += ` Generate a standard UK school risk assessment table for this activity. Include Hazards, Who might be harmed, Existing Controls, and Further Action.`;
    else if (tool === 'email_angry') systemPrompt += ` Draft a highly professional, de-escalating, and polite email response to an angry or concerned parent/carer regarding this issue.`;

    const endpoint = user.aiProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: user.aiProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o', messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Context/Topic: ${topic}` }] })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 } } });
    res.json({ text: DOMPurify.sanitize(data.choices[0].message.content, sanitizeConfig) });
}));
