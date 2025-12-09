# Cursor Rules

## Change Tracking

We maintain a daily log of changes and improvements in `.cursor/changes.md`. This file should be updated at the end of each day with:
- Recent fixes and improvements
- Ongoing work and issues
- Notable changes to architecture or patterns

**Important**: When updating `changes.md`, always add the most recent changes at the **top** of the file, tagged with the current date (e.g., `## 2025-Dec-9`). This ensures the latest work is always visible first.

See `.cursor/changes.md` for the latest updates.

## Debugging Methodology

When investigating bugs or failures, always use scientific principles to understand the root cause:

1. **Observe and Hypothesize**: First, carefully observe the actual behavior (what is happening vs. what should happen). Form a hypothesis about the root cause based on the code flow and logic.

2. **Trace Execution**: Trace through the actual execution path in the code to understand:
   - What code is being executed
   - What values variables have at each step
   - What conditions are being checked
   - What the actual control flow is

3. **Verify Assumptions**: Before making changes, verify your assumptions:
   - Check if the code you think is running is actually running
   - Verify the values you think variables have are what they actually have
   - Confirm the conditions you think are true/false are actually true/false

4. **Root Cause Analysis**: Identify the actual root cause, not just symptoms. Ask:
   - Why is this happening?
   - What is the fundamental issue in the logic or data flow?
   - What would fix it at the source?

5. **Test Hypothesis**: Make targeted changes based on your understanding of the root cause, not random attempts.
   - **Do not get stuck in analysis paralysis**: If you have a hypothesis, test it with a code change rather than continuing to think about it indefinitely
   - **Test, then refine**: Make a targeted change to test your hypothesis, run the test, observe the result, and refine your understanding based on the actual outcome
   - **Iterate quickly**: It's better to make a small test change and see what happens than to spend excessive time theorizing without verification

**DO NOT**:
- Try random changes hoping something will work
- Make changes without understanding why the current code isn't working
- Apply "fixes" without verifying they address the actual root cause
- Skip understanding the execution flow and just try different things
- **Get stuck in thinking loops**: If you've formed a hypothesis, test it with code rather than continuing to analyze indefinitely

**DO**:
- Read and understand the relevant code paths
- Trace through the execution to see what's actually happening
- Form hypotheses based on evidence from the code
- **Test hypotheses with code changes**: When you have a hypothesis, implement a targeted test change to verify it
- Make targeted fixes that address the root cause
- Verify your understanding before making changes, but don't overthink - test and iterate

