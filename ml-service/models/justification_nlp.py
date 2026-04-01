"""Justification NLP Analysis using Claude API."""
import os
import json

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY', '')


def score_justification(justification_text, diagnosis_code, test_name, outside_protocol=True):
    """
    Score a medical justification using Claude API.
    Returns validity score 0-1 with analysis.
    """
    if not HAS_ANTHROPIC or not ANTHROPIC_API_KEY or ANTHROPIC_API_KEY == 'your_key_here':
        # Fallback: rule-based scoring when API unavailable
        return _rule_based_score(justification_text, diagnosis_code, test_name, outside_protocol)
    
    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        
        system_prompt = """You are a medical audit expert reviewing doctor justifications for clinical validity. 
Score the justification from 0.0 to 1.0 where:
- 1.0 = fully valid clinical reasoning with specific medical criteria
- 0.7-0.9 = reasonable justification with some clinical basis
- 0.4-0.6 = weak justification, vague reasoning
- 0.0-0.3 = clearly invalid, no medical basis, or suspicious

Return ONLY valid JSON (no markdown, no code blocks): 
{"score": 0.0-1.0, "is_valid": true/false, "analysis": "explanation", "red_flags": ["flag1", "flag2"]}"""

        user_prompt = f"""Diagnosis: {diagnosis_code}
Test ordered: {test_name}
This test is {'outside' if outside_protocol else 'within'} standard protocol.
Doctor justification: "{justification_text}"

Is this clinically justified? Score it."""

        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}]
        )
        
        response_text = message.content[0].text.strip()
        # Try to parse JSON from response
        if response_text.startswith('```'):
            response_text = response_text.split('```')[1]
            if response_text.startswith('json'):
                response_text = response_text[4:]
        
        result = json.loads(response_text)
        return {
            'validity_score': float(result.get('score', 0.5)),
            'is_clinically_valid': result.get('is_valid', None),
            'analysis_text': result.get('analysis', ''),
            'red_flags': result.get('red_flags', [])
        }
    except Exception as e:
        print(f"Claude API error: {e}")
        return _rule_based_score(justification_text, diagnosis_code, test_name, outside_protocol)


def _rule_based_score(justification_text, diagnosis_code, test_name, outside_protocol):
    """Fallback rule-based scoring when Claude API is unavailable."""
    if not justification_text:
        return {
            'validity_score': 0.1,
            'is_clinically_valid': False,
            'analysis_text': 'No justification provided.',
            'red_flags': ['No justification text provided']
        }
    
    score = 0.5
    red_flags = []
    text_lower = justification_text.lower()
    
    # Positive indicators
    medical_terms = ['differential diagnosis', 'clinical suspicion', 'rule out', 'symptoms',
                     'presentation', 'complications', 'comorbidity', 'risk factors',
                     'elevated', 'abnormal', 'indicated', 'warranted', 'medically necessary',
                     'clinical correlation', 'follow-up', 'monitoring', 'baseline']
    
    term_count = sum(1 for term in medical_terms if term in text_lower)
    score += min(0.3, term_count * 0.05)
    
    # Length check — too short is suspicious
    if len(justification_text) < 20:
        score -= 0.2
        red_flags.append('Justification is too brief')
    elif len(justification_text) > 100:
        score += 0.1
    
    # Negative indicators
    vague_phrases = ['just in case', 'routine', 'standard practice', 'for safety',
                     'precautionary', 'general checkup', 'as requested']
    
    for phrase in vague_phrases:
        if phrase in text_lower:
            score -= 0.1
            red_flags.append(f'Vague phrase used: "{phrase}"')
    
    # Check for specific clinical reasoning
    if any(word in text_lower for word in ['because', 'due to', 'given that', 'considering']):
        score += 0.1
    
    score = max(0.0, min(1.0, score))
    
    return {
        'validity_score': round(score, 2),
        'is_clinically_valid': score >= 0.5,
        'analysis_text': f'Rule-based analysis (Claude API unavailable). Score {score:.2f}/1.0. '
                        f'Found {term_count} medical terms. {len(red_flags)} concerns identified.',
        'red_flags': red_flags
    }


def fuzzy_match_items(new_item, existing_items):
    """Fuzzy match a new bill item against existing items."""
    from difflib import SequenceMatcher
    
    best_match = None
    best_score = 0
    
    new_name = new_item.get('item_name', '').lower()
    new_price = new_item.get('total_price', 0)
    
    for item in existing_items:
        existing_name = item.get('item_name', '').lower()
        
        # String similarity
        name_sim = SequenceMatcher(None, new_name, existing_name).ratio()
        
        # Price similarity
        existing_price = item.get('total_price', 0)
        if existing_price > 0:
            price_sim = 1 - abs(new_price - existing_price) / max(new_price, existing_price, 1)
        else:
            price_sim = 0
        
        # Combined score (70% name, 30% price)
        combined = name_sim * 0.7 + price_sim * 0.3
        
        if combined > best_score:
            best_score = combined
            best_match = item
    
    is_duplicate = best_score > 0.8
    
    return {
        'is_duplicate': is_duplicate,
        'matched_item': best_match if is_duplicate else None,
        'similarity_score': round(best_score, 3)
    }
