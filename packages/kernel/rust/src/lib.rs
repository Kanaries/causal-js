use std::collections::VecDeque;

#[derive(Clone, Copy)]
enum Direction {
    Up = 0,
    Down = 1,
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc_u32(len: u32) -> *mut u32 {
    let mut buffer = Vec::<u32>::with_capacity(len as usize);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

#[unsafe(no_mangle)]
pub extern "C" fn free_u32(ptr: *mut u32, len: u32) {
    if ptr.is_null() {
        return;
    }

    unsafe {
        let _ = Vec::from_raw_parts(ptr, len as usize, len as usize);
    }
}

fn build_adjacency(
    node_count: usize,
    edge_pairs: &[u32],
) -> Result<(Vec<Vec<usize>>, Vec<Vec<usize>>), ()> {
    if !edge_pairs.len().is_multiple_of(2) {
        return Err(());
    }

    let mut parents = vec![Vec::<usize>::new(); node_count];
    let mut children = vec![Vec::<usize>::new(); node_count];

    for pair in edge_pairs.chunks_exact(2) {
        let from = pair[0] as usize;
        let to = pair[1] as usize;

        if from >= node_count || to >= node_count || from == to {
            return Err(());
        }

        if !children[from].contains(&to) {
            children[from].push(to);
        }
        if !parents[to].contains(&from) {
            parents[to].push(from);
        }
    }

    Ok((parents, children))
}

fn ancestors_of_conditioned(parents: &[Vec<usize>], conditioned: &[bool]) -> Vec<bool> {
    let mut ancestors = conditioned.to_vec();
    let mut queue = VecDeque::<usize>::new();

    for (index, value) in conditioned.iter().enumerate() {
        if *value {
            queue.push_back(index);
        }
    }

    while let Some(node) = queue.pop_front() {
        for parent in &parents[node] {
            if !ancestors[*parent] {
                ancestors[*parent] = true;
                queue.push_back(*parent);
            }
        }
    }

    ancestors
}

fn is_d_connected(
    source: usize,
    target: usize,
    conditioned: &[bool],
    parents: &[Vec<usize>],
    children: &[Vec<usize>],
) -> bool {
    let ancestors = ancestors_of_conditioned(parents, conditioned);
    let mut queue = VecDeque::<(usize, Direction)>::new();
    let mut visited = vec![[false; 2]; conditioned.len()];

    queue.push_back((source, Direction::Up));
    queue.push_back((source, Direction::Down));

    while let Some((node, direction)) = queue.pop_front() {
        let direction_index = direction as usize;
        if visited[node][direction_index] {
            continue;
        }
        visited[node][direction_index] = true;

        if node == target {
            return true;
        }

        match direction {
            Direction::Up => {
                if conditioned[node] {
                    continue;
                }

                for parent in &parents[node] {
                    queue.push_back((*parent, Direction::Up));
                }
                for child in &children[node] {
                    queue.push_back((*child, Direction::Down));
                }
            }
            Direction::Down => {
                if !conditioned[node] {
                    for child in &children[node] {
                        queue.push_back((*child, Direction::Down));
                    }
                }

                if ancestors[node] {
                    for parent in &parents[node] {
                        queue.push_back((*parent, Direction::Up));
                    }
                }
            }
        }
    }

    false
}

#[unsafe(no_mangle)]
pub extern "C" fn dag_d_separated(
    node_count: u32,
    edge_pairs_ptr: *const u32,
    edge_pairs_len: u32,
    source_index: u32,
    target_index: u32,
    conditioning_ptr: *const u32,
    conditioning_len: u32,
) -> i32 {
    let node_count = node_count as usize;
    let source_index = source_index as usize;
    let target_index = target_index as usize;

    if source_index >= node_count || target_index >= node_count || source_index == target_index {
        return -1;
    }

    let edge_pairs = unsafe { std::slice::from_raw_parts(edge_pairs_ptr, edge_pairs_len as usize) };
    let conditioning_values = unsafe { std::slice::from_raw_parts(conditioning_ptr, conditioning_len as usize) };

    let (parents, children) = match build_adjacency(node_count, edge_pairs) {
        Ok(adjacency) => adjacency,
        Err(_) => return -1,
    };

    let mut conditioned = vec![false; node_count];
    for value in conditioning_values {
        let index = *value as usize;
        if index >= node_count || index == source_index || index == target_index {
            return -1;
        }
        conditioned[index] = true;
    }

    if is_d_connected(source_index, target_index, &conditioned, &parents, &children) {
        0
    } else {
        1
    }
}
