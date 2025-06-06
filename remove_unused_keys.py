import json
import sys

def get_all_keys(data, parent_key=''):
    keys = set()
    if isinstance(data, dict):
        for k, v in data.items():
            full_key = f"{parent_key}.{k}" if parent_key else k
            keys.add(full_key)
            keys.update(get_all_keys(v, full_key))
    return keys

def filter_data(data, used_keys, parent_key=''):
    if isinstance(data, dict):
        new_data = {}
        for k, v in data.items():
            full_key = f"{parent_key}.{k}" if parent_key else k
            if full_key in used_keys:
                new_data[k] = filter_data(v, used_keys, full_key)
            elif any(used_key.startswith(full_key + ".") for used_key in used_keys): # Check if it's a parent of a used key
                 new_data[k] = filter_data(v, used_keys, full_key)
        return new_data
    return data

if __name__ == "__main__":
    used_keys_file = sys.argv[1]
    en_json_file = sys.argv[2]
    ja_json_file = sys.argv[3]

    used_keys = set()
    with open(used_keys_file, 'r') as f:
        for line in f:
            # Extract the key part after the colon
            key_part = line.strip().split(':')[-1]
            used_keys.add(key_part)

    # Process English file
    with open(en_json_file, 'r') as f:
        en_data = json.load(f)

    all_en_keys = get_all_keys(en_data)
    # Ensure that we don't remove keys that are parents of used keys
    keys_to_keep_en = set(uk for uk in all_en_keys if any(used_key.startswith(uk) for used_key in used_keys) or uk in used_keys)


    filtered_en_data = {}
    for k, v in en_data.items():
        if k in keys_to_keep_en :
            filtered_en_data[k] = filter_data(v, keys_to_keep_en, k)
        # Special case for top-level keys that might be parent containers
        elif any(used_key.startswith(k + ".") for used_key in keys_to_keep_en):
             filtered_en_data[k] = filter_data(v, keys_to_keep_en, k)


    with open(en_json_file, 'w') as f:
        json.dump(filtered_en_data, f, indent=2, ensure_ascii=False)

    # Process Japanese file
    with open(ja_json_file, 'r') as f:
        ja_data = json.load(f)

    all_ja_keys = get_all_keys(ja_data)
    keys_to_keep_ja = set(uk for uk in all_ja_keys if any(used_key.startswith(uk) for used_key in used_keys) or uk in used_keys)

    filtered_ja_data = {}
    for k, v in ja_data.items():
        if k in keys_to_keep_ja:
            filtered_ja_data[k] = filter_data(v, keys_to_keep_ja, k)
        elif any(used_key.startswith(k + ".") for used_key in keys_to_keep_ja):
            filtered_ja_data[k] = filter_data(v, keys_to_keep_ja, k)

    with open(ja_json_file, 'w') as f:
        json.dump(filtered_ja_data, f, indent=2, ensure_ascii=False)

    print("Unused keys removed successfully.")
